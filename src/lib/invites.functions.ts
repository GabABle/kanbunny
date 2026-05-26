import { supabase } from "@/integrations/supabase/client";

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Not authenticated");
  return id;
}

function genToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export async function createBoardInvite(data: { boardId: string; role?: "editor" | "viewer" | "member" }) {
  const userId = await currentUserId();
  const token = genToken();
  const { data: inv, error } = await supabase
    .from("board_invites")
    .insert({ board_id: data.boardId, role: data.role ?? "member", created_by: userId, token })
    .select("token")
    .single();
  if (error) throw new Error(error.message);
  return { token: inv.token };
}

export async function acceptBoardInvite(data: { token: string }) {
  const { data: boardId, error } = await supabase.rpc("accept_board_invite", { _token: data.token });
  if (error) throw new Error(error.message);
  if (!boardId) throw new Error("Invite not found or no longer valid.");
  return { boardId: boardId as string };
}