
REVOKE EXECUTE ON FUNCTION public.is_board_member(UUID, UUID) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.board_role_of(UUID, UUID) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.can_edit_board(UUID, UUID) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.board_of_list(UUID) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.board_of_card(UUID) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.board_of_checklist(UUID) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.add_owner_as_member() FROM anon, authenticated, public;
