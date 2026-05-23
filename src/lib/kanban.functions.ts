import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

// ---------- Activity helper ----------
async function logActivity(
  supabase: any,
  userId: string,
  cardId: string,
  type: string,
  payload: Record<string, unknown> = {},
) {
  try {
    await supabase.from("card_activities").insert({
      card_id: cardId,
      user_id: userId,
      type,
      payload,
    });
  } catch (_e) {
    // never fail user action because of activity log
  }
}

async function cardIdFromChecklist(supabase: any, checklistId: string): Promise<string | null> {
  const { data } = await supabase.from("checklists").select("card_id").eq("id", checklistId).maybeSingle();
  return data?.card_id ?? null;
}
async function cardIdFromItem(supabase: any, itemId: string): Promise<string | null> {
  const { data } = await supabase.from("checklist_items").select("checklist_id").eq("id", itemId).maybeSingle();
  if (!data) return null;
  return cardIdFromChecklist(supabase, data.checklist_id);
}
// ---------- Boards ----------
export const listBoards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("boards")
      .select("id, title, description, owner_id, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ title: z.string().min(1).max(120), description: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: board, error } = await supabase
      .from("boards")
      .insert({ title: data.title, description: data.description ?? null, owner_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Seed three default lists
    const seeds = ["To do", "In progress", "Done"].map((title, i) => ({
      board_id: board.id,
      title,
      position: (i + 1) * 1000,
    }));
    await supabase.from("lists").insert(seeds);
    return board;
  });

export const deleteBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("boards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, title: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("boards").update({ title: data.title }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Board detail ----------
export const getBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const boardRes = await supabase.from("boards").select("id, title, description, owner_id, created_at").eq("id", data.id).maybeSingle();
    if (boardRes.error) throw new Error(boardRes.error.message);
    if (!boardRes.data) throw new Error("Board not found");

    const [listsRes, cardsRes, labelsRes, cardLabelsRes, assigneesRes, membersRes] = await Promise.all([
      supabase.from("lists").select("id, title, position").eq("board_id", data.id).order("position"),
      supabase
        .from("cards")
        .select("id, list_id, title, description, position, due_date, created_at")
        .in("list_id", (await supabase.from("lists").select("id").eq("board_id", data.id)).data?.map((l) => l.id) ?? [])
        .order("position"),
      supabase.from("labels").select("id, name, color").eq("board_id", data.id),
      supabase.from("card_labels").select("card_id, label_id"),
      supabase.from("card_assignees").select("card_id, user_id"),
      supabase
        .from("board_members")
        .select("user_id, role")
        .eq("board_id", data.id),
    ]);

    for (const r of [listsRes, cardsRes, labelsRes, cardLabelsRes, assigneesRes, membersRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const memberIds = (membersRes.data ?? []).map((m: any) => m.user_id);
    const profilesRes = memberIds.length
      ? await supabase.from("profiles").select("id, display_name, avatar_url, email").in("id", memberIds)
      : { data: [], error: null as any };
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));

    // Determine role
    const me = (membersRes.data ?? []).find((m: any) => m.user_id === userId);
    const role = me?.role ?? (boardRes.data.owner_id === userId ? "owner" : "viewer");

    return {
      board: boardRes.data,
      role,
      lists: listsRes.data ?? [],
      cards: cardsRes.data ?? [],
      labels: labelsRes.data ?? [],
      cardLabels: cardLabelsRes.data ?? [],
      assignees: assigneesRes.data ?? [],
      members: (membersRes.data ?? []).map((m: any) => ({
        user_id: m.user_id,
        role: m.role,
        profile: profileMap.get(m.user_id) ?? null,
      })),
    };
  });

// ---------- Lists ----------
export const createList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ boardId: uuid, title: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: last } = await supabase.from("lists").select("position").eq("board_id", data.boardId).order("position", { ascending: false }).limit(1).maybeSingle();
    const pos = (last?.position ?? 0) + 1000;
    const { data: list, error } = await supabase.from("lists").insert({ board_id: data.boardId, title: data.title, position: pos }).select().single();
    if (error) throw new Error(error.message);
    return list;
  });

export const renameList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, title: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("lists").update({ title: data.title }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("lists").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, position: z.number() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("lists").update({ position: data.position }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Cards ----------
export const createCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ listId: uuid, title: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: last } = await supabase.from("cards").select("position").eq("list_id", data.listId).order("position", { ascending: false }).limit(1).maybeSingle();
    const pos = (last?.position ?? 0) + 1000;
    const { data: card, error } = await supabase
      .from("cards")
      .insert({ list_id: data.listId, title: data.title, position: pos, created_by: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, userId, card.id, "card_created", { title: data.title });
    return card;
  });

export const updateCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: uuid,
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(10000).nullable().optional(),
      due_date: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const { supabase, userId } = context;
    const { error } = await supabase.from("cards").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    if ("title" in rest) await logActivity(supabase, userId, id, "title_changed", { title: rest.title });
    if ("description" in rest) await logActivity(supabase, userId, id, "description_changed", {});
    if ("due_date" in rest) await logActivity(supabase, userId, id, rest.due_date ? "due_set" : "due_removed", { due_date: rest.due_date });
    return { ok: true };
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, listId: uuid, position: z.number() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase.from("cards").select("list_id").eq("id", data.id).maybeSingle();
    const { error } = await supabase.from("cards").update({ list_id: data.listId, position: data.position }).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (prev && prev.list_id !== data.listId) {
      const [from, to] = await Promise.all([
        supabase.from("lists").select("title").eq("id", prev.list_id).maybeSingle(),
        supabase.from("lists").select("title").eq("id", data.listId).maybeSingle(),
      ]);
      await logActivity(supabase, userId, data.id, "moved", { from: from.data?.title, to: to.data?.title });
    }
    return { ok: true };
  });

// ---------- Labels ----------
export const createLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ boardId: uuid, name: z.string().min(1).max(50), color: z.string().min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: label, error } = await context.supabase.from("labels").insert({ board_id: data.boardId, name: data.name, color: data.color }).select().single();
    if (error) throw new Error(error.message);
    return label;
  });

export const toggleCardLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid, labelId: uuid, on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.on) {
      const { error } = await supabase.from("card_labels").insert({ card_id: data.cardId, label_id: data.labelId });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("card_labels").delete().eq("card_id", data.cardId).eq("label_id", data.labelId);
      if (error) throw new Error(error.message);
    }
    const { data: lbl } = await supabase.from("labels").select("name, color").eq("id", data.labelId).maybeSingle();
    await logActivity(supabase, userId, data.cardId, data.on ? "label_added" : "label_removed", { name: lbl?.name, color: lbl?.color });
    return { ok: true };
  });

// ---------- Members ----------
export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ boardId: uuid, email: z.string().email(), role: z.enum(["editor", "viewer"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: profile, error: pErr } = await supabase.from("profiles").select("id").eq("email", data.email).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("No user with that email has signed up yet.");
    const { error } = await supabase.from("board_members").insert({ board_id: data.boardId, user_id: profile.id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ boardId: uuid, userId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("board_members").delete().eq("board_id", data.boardId).eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleAssignee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid, userId: uuid, on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.on) {
      const { error } = await supabase.from("card_assignees").insert({ card_id: data.cardId, user_id: data.userId });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("card_assignees").delete().eq("card_id", data.cardId).eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }
    const { data: p } = await supabase.from("profiles").select("display_name, email").eq("id", data.userId).maybeSingle();
    await logActivity(supabase, userId, data.cardId, data.on ? "member_added" : "member_removed", { name: p?.display_name ?? p?.email });
    return { ok: true };
  });

// ---------- Checklists ----------
export const addChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid, title: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cl, error } = await context.supabase.from("checklists").insert({ card_id: data.cardId, title: data.title }).select().single();
    if (error) throw new Error(error.message);
    return cl;
  });

export const addChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ checklistId: uuid, text: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: item, error } = await context.supabase.from("checklist_items").insert({ checklist_id: data.checklistId, text: data.text }).select().single();
    if (error) throw new Error(error.message);
    return item;
  });

export const toggleChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("checklist_items").update({ done: data.done }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("checklist_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("checklist_items").delete().eq("checklist_id", data.id);
    const { error } = await context.supabase.from("checklists").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("labels").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCardChecklists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const cls = await supabase.from("checklists").select("id, title, position").eq("card_id", data.cardId).order("position");
    if (cls.error) throw new Error(cls.error.message);
    const ids = (cls.data ?? []).map((c) => c.id);
    const items = ids.length
      ? await supabase.from("checklist_items").select("id, checklist_id, text, done, position").in("checklist_id", ids).order("position")
      : { data: [], error: null as any };
    if (items.error) throw new Error(items.error.message);
    return { checklists: cls.data ?? [], items: items.data ?? [] };
  });

// ---------- Comments ----------
export const getCardComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("card_comments")
      .select("id, card_id, user_id, body, created_at, updated_at")
      .eq("card_id", data.cardId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const profilesRes = ids.length
      ? await supabase.from("profiles").select("id, display_name, avatar_url, email").in("id", ids)
      : { data: [], error: null as any };
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    const map = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    return (rows ?? []).map((r) => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

export const addCardComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid, body: z.string().min(1).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("card_comments")
      .insert({ card_id: data.cardId, user_id: userId, body: data.body })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateCardComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, body: z.string().min(1).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("card_comments").update({ body: data.body }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCardComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("card_comments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Attachments ----------
export const listCardAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ cardId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("card_attachments")
      .select("id, card_id, user_id, file_name, file_path, mime_type, size_bytes, created_at")
      .eq("card_id", data.cardId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addCardAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      cardId: uuid,
      file_path: z.string().min(1).max(500),
      file_name: z.string().min(1).max(255),
      mime_type: z.string().max(150).optional().nullable(),
      size_bytes: z.number().int().nonnegative().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("card_attachments")
      .insert({
        card_id: data.cardId,
        user_id: userId,
        file_path: data.file_path,
        file_name: data.file_name,
        mime_type: data.mime_type ?? null,
        size_bytes: data.size_bytes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteCardAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error: gErr } = await supabase
      .from("card_attachments").select("file_path").eq("id", data.id).maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (row?.file_path) {
      await supabase.storage.from("card-attachments").remove([row.file_path]);
    }
    const { error } = await supabase.from("card_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ file_path: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("card-attachments")
      .createSignedUrl(data.file_path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });