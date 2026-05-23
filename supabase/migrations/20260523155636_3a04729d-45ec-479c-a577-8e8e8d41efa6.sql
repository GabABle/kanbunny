GRANT EXECUTE ON FUNCTION public.is_board_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_board(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_role_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_of_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_of_card(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_of_checklist(uuid) TO authenticated;