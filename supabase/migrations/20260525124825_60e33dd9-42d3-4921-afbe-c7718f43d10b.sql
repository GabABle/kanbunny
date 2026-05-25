
CREATE OR REPLACE FUNCTION public.accept_board_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv RECORD;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT board_id, role, expires_at INTO _inv
  FROM public.board_invites WHERE token = _token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or no longer valid.';
  END IF;
  IF _inv.expires_at IS NOT NULL AND _inv.expires_at < now() THEN
    RAISE EXCEPTION 'This invite has expired.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.boards WHERE id = _inv.board_id AND owner_id = _uid) THEN
    RETURN _inv.board_id;
  END IF;
  INSERT INTO public.board_members (board_id, user_id, role)
  VALUES (_inv.board_id, _uid, _inv.role)
  ON CONFLICT DO NOTHING;
  RETURN _inv.board_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_board_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_board_invite(text) TO authenticated;
