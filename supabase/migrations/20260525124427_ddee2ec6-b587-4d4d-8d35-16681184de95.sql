
CREATE TABLE public.board_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  role public.board_role NOT NULL DEFAULT 'editor',
  created_by uuid NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX board_invites_board_id_idx ON public.board_invites(board_id);

ALTER TABLE public.board_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage invites"
ON public.board_invites
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_id AND b.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_id AND b.owner_id = auth.uid()));
