import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

function genToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export const createBoardInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      boardId: uuid,
      role: z.enum(["editor", "viewer", "member"]).default("member"),
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
    const { supabase } = context;
    const { data: boardId, error } = await supabase.rpc("accept_board_invite", { _token: data.token });
    if (error) throw new Error(error.message);
    if (!boardId) throw new Error("Invite not found or no longer valid.");
    return { boardId: boardId as string };
  });