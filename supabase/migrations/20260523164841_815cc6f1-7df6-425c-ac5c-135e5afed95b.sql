CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.card_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id uuid NOT NULL,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_card_comments_card_id ON public.card_comments(card_id);

ALTER TABLE public.card_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View comments" ON public.card_comments FOR SELECT TO authenticated
USING (public.is_board_member(public.board_of_card(card_id), auth.uid()));

CREATE POLICY "Create own comments" ON public.card_comments FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.is_board_member(public.board_of_card(card_id), auth.uid()));

CREATE POLICY "Update own comments" ON public.card_comments FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Delete own comments or board editor" ON public.card_comments FOR DELETE TO authenticated
USING (auth.uid() = user_id OR public.can_edit_board(public.board_of_card(card_id), auth.uid()));

CREATE TRIGGER update_card_comments_updated_at
BEFORE UPDATE ON public.card_comments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();