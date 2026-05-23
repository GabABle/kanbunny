-- Add parent_id to comments for replies
ALTER TABLE public.card_comments ADD COLUMN parent_id uuid REFERENCES public.card_comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS card_comments_parent_idx ON public.card_comments(parent_id);

-- Activity history table
CREATE TABLE public.card_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id uuid NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX card_activities_card_idx ON public.card_activities(card_id, created_at DESC);

ALTER TABLE public.card_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View card activities" ON public.card_activities
  FOR SELECT TO authenticated
  USING (public.is_board_member(public.board_of_card(card_id), auth.uid()));

CREATE POLICY "Insert own activities" ON public.card_activities
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_board_member(public.board_of_card(card_id), auth.uid()));
