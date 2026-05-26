
-- 1) shares_board_with helper (SECURITY DEFINER, avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.shares_board_with(_profile_id uuid, _viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_members bm1
    JOIN public.board_members bm2 ON bm1.board_id = bm2.board_id
    WHERE bm1.user_id = _profile_id AND bm2.user_id = _viewer_id
  ) OR EXISTS (
    SELECT 1 FROM public.boards b
    JOIN public.board_members bm ON bm.board_id = b.id
    WHERE (b.owner_id = _profile_id AND bm.user_id = _viewer_id)
       OR (b.owner_id = _viewer_id AND bm.user_id = _profile_id)
  ) OR EXISTS (
    SELECT 1 FROM public.boards b1
    JOIN public.boards b2 ON b1.owner_id = _profile_id AND b2.owner_id = _viewer_id AND b1.id = b2.id
  );
$$;

-- 2) Tighten profiles SELECT policy
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Profiles readable to self or shared board members"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.shares_board_with(id, auth.uid()));

-- 3) Lock down SECURITY DEFINER function execute privileges
REVOKE EXECUTE ON FUNCTION public.shares_board_with(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_board_with(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.board_of_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_of_card(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.board_of_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_of_list(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.board_of_checklist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_of_checklist(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_edit_board(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_board(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_board_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_board_member(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.board_role_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_role_of(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.accept_board_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_board_invite(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.pick_avatar_color(uuid) FROM PUBLIC, anon;

-- Trigger functions: not user-callable
REVOKE EXECUTE ON FUNCTION public.add_owner_as_member() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
