
CREATE TABLE public.card_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.card_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View attachments" ON public.card_attachments
  FOR SELECT TO authenticated
  USING (public.is_board_member(public.board_of_card(card_id), auth.uid()));

CREATE POLICY "Create attachments" ON public.card_attachments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_edit_board(public.board_of_card(card_id), auth.uid()));

CREATE POLICY "Delete attachments" ON public.card_attachments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.can_edit_board(public.board_of_card(card_id), auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('card-attachments', 'card-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Board members can read card attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'card-attachments'
    AND EXISTS (
      SELECT 1 FROM public.card_attachments ca
      WHERE ca.file_path = storage.objects.name
        AND public.is_board_member(public.board_of_card(ca.card_id), auth.uid())
    )
  );

CREATE POLICY "Board editors can upload card attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-attachments');

CREATE POLICY "Board editors can delete card attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'card-attachments'
    AND EXISTS (
      SELECT 1 FROM public.card_attachments ca
      WHERE ca.file_path = storage.objects.name
        AND (ca.user_id = auth.uid() OR public.can_edit_board(public.board_of_card(ca.card_id), auth.uid()))
    )
  );
