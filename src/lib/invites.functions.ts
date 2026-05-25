import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const uuid = z.string().uuid();

function genToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export const createBoardInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      boardId: uuid,
      role: z.enum(["editor", "viewer"]).default("editor"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // RLS ensures only the owner can insert
    const token = genToken();
    const { data: inv, error } = await supabase
      .from("board_invites")
      .insert({ board_id: data.boardId, role: data.role, created_by: userId, token })
      .select("token")
      .single();
    if (error) throw new Error(error.message);
    return { token: inv.token };
  });

export const acceptBoardInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ token: z.string().min(10).max(128) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: inv, error } = await supabaseAdmin
      .from("board_invites")
      .select("board_id, role, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invite not found or no longer valid.");
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      throw new Error("This invite has expired.");
    }
    // Owner already has access
    const { data: board } = await supabaseAdmin
      .from("boards")
      .select("owner_id")
      .eq("id", inv.board_id)
      .maybeSingle();
    if (board?.owner_id === userId) return { boardId: inv.board_id };
    const { error: insErr } = await supabaseAdmin
      .from("board_members")
      .upsert(
        { board_id: inv.board_id, user_id: userId, role: inv.role },
        { onConflict: "board_id,user_id", ignoreDuplicates: true },
      );
    if (insErr) throw new Error(insErr.message);
    return { boardId: inv.board_id };
  });