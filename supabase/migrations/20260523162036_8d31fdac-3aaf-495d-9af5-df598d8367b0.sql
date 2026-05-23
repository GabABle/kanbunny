ALTER POLICY "View accessible boards"
ON public.boards
USING ((owner_id = auth.uid()) OR public.is_board_member(id, auth.uid()));