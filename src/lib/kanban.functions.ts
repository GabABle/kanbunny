import { supabase } from "@/integrations/supabase/client";

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Not authenticated");
  return id;
}

async function logActivity(userId: string, cardId: string, type: string, payload: Record<string, unknown> = {}) {
  try {
    await supabase.from("card_activities").insert({ card_id: cardId, user_id: userId, type, payload: payload as any });
  } catch { /* never fail user action for activity log */ }
}

async function cardIdFromChecklist(checklistId: string): Promise<string | null> {
  const { data } = await supabase.from("checklists").select("card_id").eq("id", checklistId).maybeSingle();
  return data?.card_id ?? null;
}

// ---------- Boards ----------
export async function listBoards() {
  const { data, error } = await supabase
    .from("boards")
    .select("id, title, description, owner_id, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createBoard(data: { title: string; description?: string }) {
  const userId = await currentUserId();
  const { data: board, error } = await supabase
    .from("boards")
    .insert({ title: data.title, description: data.description ?? null, owner_id: userId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const seeds = ["Backlog", "In progress", "Done"].map((title, i) => ({
    board_id: board.id, title, position: (i + 1) * 1000,
  }));
  await supabase.from("lists").insert(seeds);
  return board;
}

export async function deleteBoard(data: { id: string }) {
  const { error } = await supabase.from("boards").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function renameBoard(data: { id: string; title: string }) {
  const { error } = await supabase.from("boards").update({ title: data.title }).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updateBoardBackground(data: { id: string; background_gradient: string | null }) {
  const { error } = await supabase
    .from("boards")
    .update({ background_gradient: data.background_gradient } as any)
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------- Board detail ----------
export async function getBoard(data: { id: string }) {
  const userId = await currentUserId();
  const boardRes = await supabase.from("boards").select("id, title, description, owner_id, created_at, background_gradient").eq("id", data.id).maybeSingle();
  if (boardRes.error) throw new Error(boardRes.error.message);
  if (!boardRes.data) throw new Error("Board not found");

  const [listsRes, cardsRes, labelsRes, cardLabelsRes, assigneesRes, membersRes] = await Promise.all([
    supabase.from("lists").select("id, title, position").eq("board_id", data.id).order("position"),
    supabase
      .from("cards")
      .select("id, list_id, title, description, position, due_date, created_at, created_by")
      .in("list_id", (await supabase.from("lists").select("id").eq("board_id", data.id)).data?.map((l) => l.id) ?? [])
      .eq("archived" as any, false)
      .order("position"),
    supabase.from("labels").select("id, name, color").eq("board_id", data.id),
    supabase.from("card_labels").select("card_id, label_id"),
    supabase.from("card_assignees").select("card_id, user_id"),
    supabase.from("board_members").select("user_id, role").eq("board_id", data.id),
  ]);

  for (const r of [listsRes, cardsRes, labelsRes, cardLabelsRes, assigneesRes, membersRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const memberIds = (membersRes.data ?? []).map((m: any) => m.user_id);
  const profilesRes = memberIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url, avatar_color, email").in("id", memberIds)
    : { data: [], error: null as any };
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));

  const me = (membersRes.data ?? []).find((m: any) => m.user_id === userId);
  const role = me?.role ?? (boardRes.data.owner_id === userId ? "owner" : "viewer");

  const cardIds = (cardsRes.data ?? []).map((c: any) => c.id);
  let recentlyChangedCardIds: string[] = [];
  if (cardIds.length) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const actRes = await supabase
      .from("card_activities").select("card_id")
      .in("card_id", cardIds).gte("created_at", since);
    if (!actRes.error) {
      recentlyChangedCardIds = Array.from(new Set((actRes.data ?? []).map((a: any) => a.card_id)));
    }
  }

  return {
    board: boardRes.data,
    role,
    lists: listsRes.data ?? [],
    cards: cardsRes.data ?? [],
    labels: labelsRes.data ?? [],
    cardLabels: cardLabelsRes.data ?? [],
    assignees: assigneesRes.data ?? [],
    recentlyChangedCardIds,
    members: (membersRes.data ?? []).map((m: any) => ({
      user_id: m.user_id, role: m.role, profile: profileMap.get(m.user_id) ?? null,
    })),
  };
}

// ---------- Lists ----------
export async function createList(data: { boardId: string; title: string }) {
  const { data: last } = await supabase.from("lists").select("position").eq("board_id", data.boardId).order("position", { ascending: false }).limit(1).maybeSingle();
  const pos = (last?.position ?? 0) + 1000;
  const { data: list, error } = await supabase.from("lists").insert({ board_id: data.boardId, title: data.title, position: pos }).select().single();
  if (error) throw new Error(error.message);
  return list;
}

export async function renameList(data: { id: string; title: string }) {
  const { error } = await supabase.from("lists").update({ title: data.title }).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteList(data: { id: string }) {
  const { error } = await supabase.from("lists").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function moveList(data: { id: string; position: number }) {
  const { error } = await supabase.from("lists").update({ position: data.position }).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------- Cards ----------
export async function createCard(data: { listId: string; title: string }) {
  const userId = await currentUserId();
  const { data: last } = await supabase.from("cards").select("position").eq("list_id", data.listId).order("position", { ascending: false }).limit(1).maybeSingle();
  const pos = (last?.position ?? 0) + 1000;
  const { data: card, error } = await supabase
    .from("cards")
    .insert({ list_id: data.listId, title: data.title, position: pos, created_by: userId })
    .select().single();
  if (error) throw new Error(error.message);
  await logActivity(userId, card.id, "card_created", { title: data.title });
  return card;
}

export async function updateCard(data: { id: string; title?: string; description?: string | null; due_date?: string | null }) {
  const userId = await currentUserId();
  const { id, ...rest } = data;
  const { error } = await supabase.from("cards").update(rest).eq("id", id);
  if (error) throw new Error(error.message);
  if ("title" in rest) await logActivity(userId, id, "title_changed", { title: rest.title });
  if ("description" in rest) await logActivity(userId, id, "description_changed", {});
  if ("due_date" in rest) await logActivity(userId, id, rest.due_date ? "due_set" : "due_removed", { due_date: rest.due_date });
  return { ok: true };
}

export async function deleteCard(data: { id: string }) {
  const { error } = await supabase.from("cards").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function archiveCard(data: { id: string; archived?: boolean }) {
  const userId = await currentUserId();
  const archived = data.archived ?? true;
  const { error } = await supabase.from("cards").update({ archived } as any).eq("id", data.id);
  if (error) throw new Error(error.message);
  await logActivity(userId, data.id, archived ? "card_archived" : "card_unarchived", {});
  return { ok: true };
}

export async function moveCard(data: { id: string; listId: string; position: number }) {
  const userId = await currentUserId();
  const { data: prev } = await supabase.from("cards").select("list_id").eq("id", data.id).maybeSingle();
  const { error } = await supabase.from("cards").update({ list_id: data.listId, position: data.position }).eq("id", data.id);
  if (error) throw new Error(error.message);
  if (prev && prev.list_id !== data.listId) {
    const [from, to] = await Promise.all([
      supabase.from("lists").select("title").eq("id", prev.list_id).maybeSingle(),
      supabase.from("lists").select("title").eq("id", data.listId).maybeSingle(),
    ]);
    await logActivity(userId, data.id, "moved", { from: from.data?.title, to: to.data?.title });
  }
  return { ok: true };
}

// ---------- Labels ----------
export async function createLabel(data: { boardId: string; name: string; color: string }) {
  const { data: label, error } = await supabase.from("labels").insert({ board_id: data.boardId, name: data.name, color: data.color }).select().single();
  if (error) throw new Error(error.message);
  return label;
}

export async function toggleCardLabel(data: { cardId: string; labelId: string; on: boolean }) {
  const userId = await currentUserId();
  if (data.on) {
    const { error } = await supabase.from("card_labels").insert({ card_id: data.cardId, label_id: data.labelId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("card_labels").delete().eq("card_id", data.cardId).eq("label_id", data.labelId);
    if (error) throw new Error(error.message);
  }
  const { data: lbl } = await supabase.from("labels").select("name, color").eq("id", data.labelId).maybeSingle();
  await logActivity(userId, data.cardId, data.on ? "label_added" : "label_removed", { name: lbl?.name, color: lbl?.color });
  return { ok: true };
}

export async function deleteLabel(data: { id: string }) {
  const { error } = await supabase.from("labels").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------- Members ----------
export async function inviteMember(data: { boardId: string; username: string; role: "editor" | "viewer" | "member" }) {
  const uname = data.username.trim();
  const { data: matches, error: pErr } = await supabase
    .from("profiles").select("id, display_name").ilike("display_name", uname).limit(2);
  if (pErr) throw new Error(pErr.message);
  if (!matches || matches.length === 0) return { ok: false, error: `No user found with username "@${uname}".` } as const;
  if (matches.length > 1) return { ok: false, error: `Multiple users match "@${uname}". Please be more specific.` } as const;
  const { error } = await supabase.from("board_members").insert({ board_id: data.boardId, user_id: matches[0].id, role: data.role });
  if (error) return { ok: false, error: error.message } as const;
  return { ok: true } as const;
}

export async function removeMember(data: { boardId: string; userId: string }) {
  const { error } = await supabase.from("board_members").delete().eq("board_id", data.boardId).eq("user_id", data.userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function toggleAssignee(data: { cardId: string; userId: string; on: boolean }) {
  const userId = await currentUserId();
  if (data.on) {
    const { error } = await supabase.from("card_assignees").insert({ card_id: data.cardId, user_id: data.userId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("card_assignees").delete().eq("card_id", data.cardId).eq("user_id", data.userId);
    if (error) throw new Error(error.message);
  }
  const { data: p } = await supabase.from("profiles").select("display_name, email").eq("id", data.userId).maybeSingle();
  await logActivity(userId, data.cardId, data.on ? "member_added" : "member_removed", { name: p?.display_name ?? p?.email });
  return { ok: true };
}

// ---------- Checklists ----------
export async function addChecklist(data: { cardId: string; title: string }) {
  const userId = await currentUserId();
  const { data: cl, error } = await supabase.from("checklists").insert({ card_id: data.cardId, title: data.title }).select().single();
  if (error) throw new Error(error.message);
  await logActivity(userId, data.cardId, "checklist_added", { title: data.title });
  return cl;
}

export async function addChecklistItem(data: { checklistId: string; text: string }) {
  const userId = await currentUserId();
  const { data: item, error } = await supabase.from("checklist_items").insert({ checklist_id: data.checklistId, text: data.text }).select().single();
  if (error) throw new Error(error.message);
  const cardId = await cardIdFromChecklist(data.checklistId);
  if (cardId) await logActivity(userId, cardId, "checklist_item_added", { text: data.text });
  return item;
}

export async function toggleChecklistItem(data: { id: string; done: boolean }) {
  const userId = await currentUserId();
  const { data: item } = await supabase.from("checklist_items").select("text, checklist_id").eq("id", data.id).maybeSingle();
  const { error } = await supabase.from("checklist_items").update({ done: data.done }).eq("id", data.id);
  if (error) throw new Error(error.message);
  if (item) {
    const cardId = await cardIdFromChecklist(item.checklist_id);
    if (cardId) await logActivity(userId, cardId, data.done ? "checklist_item_done" : "checklist_item_undone", { text: item.text });
  }
  return { ok: true };
}

export async function deleteChecklistItem(data: { id: string }) {
  const { error } = await supabase.from("checklist_items").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteChecklist(data: { id: string }) {
  await supabase.from("checklist_items").delete().eq("checklist_id", data.id);
  const { error } = await supabase.from("checklists").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function renameChecklist(data: { id: string; title: string }) {
  const { error } = await supabase.from("checklists").update({ title: data.title }).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getCardChecklists(data: { cardId: string }) {
  const cls = await supabase.from("checklists").select("id, title, position").eq("card_id", data.cardId).order("position");
  if (cls.error) throw new Error(cls.error.message);
  const ids = (cls.data ?? []).map((c) => c.id);
  const items = ids.length
    ? await supabase.from("checklist_items").select("id, checklist_id, text, done, position").in("checklist_id", ids).order("position")
    : { data: [], error: null as any };
  if (items.error) throw new Error(items.error.message);
  return { checklists: cls.data ?? [], items: items.data ?? [] };
}

// ---------- Comments ----------
export async function getCardComments(data: { cardId: string }) {
  const { data: rows, error } = await supabase
    .from("card_comments")
    .select("id, card_id, user_id, body, created_at, updated_at, parent_id")
    .eq("card_id", data.cardId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  const profilesRes = ids.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url, avatar_color, email").in("id", ids)
    : { data: [], error: null as any };
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const map = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
  return (rows ?? []).map((r) => ({ ...r, profile: map.get(r.user_id) ?? null }));
}

export async function addCardComment(data: { cardId: string; body: string; parent_id?: string | null }) {
  const userId = await currentUserId();
  const { data: row, error } = await supabase
    .from("card_comments")
    .insert({ card_id: data.cardId, user_id: userId, body: data.body, parent_id: data.parent_id ?? null } as any)
    .select().single();
  if (error) throw new Error(error.message);
  return row;
}

export async function updateCardComment(data: { id: string; body: string }) {
  const { error } = await supabase.from("card_comments").update({ body: data.body }).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteCardComment(data: { id: string }) {
  const { error } = await supabase.from("card_comments").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------- Attachments ----------
export async function listCardAttachments(data: { cardId: string }) {
  const { data: rows, error } = await supabase
    .from("card_attachments")
    .select("id, card_id, user_id, file_name, file_path, mime_type, size_bytes, created_at")
    .eq("card_id", data.cardId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return rows ?? [];
}

export async function addCardAttachment(data: {
  cardId: string; file_path: string; file_name: string;
  mime_type?: string | null; size_bytes?: number | null;
}) {
  const userId = await currentUserId();
  const { data: row, error } = await supabase
    .from("card_attachments")
    .insert({
      card_id: data.cardId, user_id: userId,
      file_path: data.file_path, file_name: data.file_name,
      mime_type: data.mime_type ?? null, size_bytes: data.size_bytes ?? null,
    })
    .select().single();
  if (error) throw new Error(error.message);
  return row;
}

export async function deleteCardAttachment(data: { id: string }) {
  const { data: row, error: gErr } = await supabase.from("card_attachments").select("file_path").eq("id", data.id).maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (row?.file_path) {
    await supabase.storage.from("card-attachments").remove([row.file_path]);
  }
  const { error } = await supabase.from("card_attachments").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getAttachmentUrl(data: { file_path: string }) {
  const { data: signed, error } = await supabase.storage.from("card-attachments").createSignedUrl(data.file_path, 60 * 10);
  if (error) throw new Error(error.message);
  return { url: signed.signedUrl };
}

// ---------- Activities ----------
export async function getCardActivities(data: { cardId: string }) {
  const { data: rows, error } = await supabase
    .from("card_activities" as any)
    .select("id, card_id, user_id, type, payload, created_at")
    .eq("card_id", data.cardId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
  const profilesRes = ids.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url, avatar_color, email").in("id", ids)
    : { data: [], error: null as any };
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const map = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
  return (rows ?? []).map((r: any) => ({ ...r, profile: map.get(r.user_id) ?? null }));
}

// ---------- Combined card details ----------
export async function getCardDetails(data: { cardId: string }) {
  const cardId = data.cardId;
  const [clsRes, commentsRes, attachmentsRes, activitiesRes] = await Promise.all([
    supabase.from("checklists").select("id, title, position").eq("card_id", cardId).order("position"),
    supabase
      .from("card_comments")
      .select("id, card_id, user_id, body, created_at, updated_at, parent_id")
      .eq("card_id", cardId).order("created_at", { ascending: false }),
    supabase
      .from("card_attachments")
      .select("id, card_id, user_id, file_name, file_path, mime_type, size_bytes, created_at")
      .eq("card_id", cardId).order("created_at", { ascending: false }),
    supabase
      .from("card_activities" as any)
      .select("id, card_id, user_id, type, payload, created_at")
      .eq("card_id", cardId).order("created_at", { ascending: false }),
  ]);
  for (const r of [clsRes, commentsRes, attachmentsRes, activitiesRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const clIds = (clsRes.data ?? []).map((c: any) => c.id);
  const itemsRes = clIds.length
    ? await supabase.from("checklist_items").select("id, checklist_id, text, done, position").in("checklist_id", clIds).order("position")
    : { data: [], error: null as any };
  if (itemsRes.error) throw new Error(itemsRes.error.message);

  const userIds = Array.from(new Set([
    ...(commentsRes.data ?? []).map((r: any) => r.user_id),
    ...((activitiesRes.data ?? []) as any[]).map((r: any) => r.user_id),
  ]));
  const profilesRes = userIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url, avatar_color, email").in("id", userIds)
    : { data: [], error: null as any };
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
  const comments = (commentsRes.data ?? []).map((r: any) => ({ ...r, profile: profileMap.get(r.user_id) ?? null }));
  const activities = ((activitiesRes.data ?? []) as any[]).map((r: any) => ({ ...r, profile: profileMap.get(r.user_id) ?? null }));

  return {
    checklists: clsRes.data ?? [],
    items: itemsRes.data ?? [],
    comments,
    attachments: attachmentsRes.data ?? [],
    activities,
  };
}

// ---------- Card owner ----------
export async function updateCardOwner(data: { cardId: string; userId: string }) {
  const userId = await currentUserId();
  const { data: cardRow, error: cErr } = await supabase.from("cards").select("id, list_id").eq("id", data.cardId).maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!cardRow) throw new Error("Card not found");
  const { data: listRow } = await supabase.from("lists").select("board_id").eq("id", cardRow.list_id).maybeSingle();
  if (!listRow) throw new Error("List not found");
  const { data: boardRow } = await supabase.from("boards").select("owner_id").eq("id", listRow.board_id).maybeSingle();
  const { data: memberRow } = await supabase.from("board_members").select("user_id")
    .eq("board_id", listRow.board_id).eq("user_id", data.userId).maybeSingle();
  if (!memberRow && boardRow?.owner_id !== data.userId) {
    throw new Error("User is not a member of this board");
  }
  const { error } = await supabase.from("cards").update({ created_by: data.userId }).eq("id", data.cardId);
  if (error) throw new Error(error.message);
  const { data: p } = await supabase.from("profiles").select("display_name, email").eq("id", data.userId).maybeSingle();
  await logActivity(userId, data.cardId, "owner_changed", { name: p?.display_name ?? p?.email });
  return { ok: true };
}

// ---------- Profile search ----------
export async function searchProfiles(data: { query?: string }) {
  const q = (data.query ?? "").trim();
  let req = supabase.from("profiles").select("id, display_name, email, avatar_url").limit(10);
  if (q.length > 0) req = req.ilike("display_name", `${q}%`);
  const { data: rows, error } = await req;
  if (error) throw new Error(error.message);
  return rows ?? [];
}
