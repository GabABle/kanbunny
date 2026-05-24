ALTER TABLE public.cards ADD COLUMN archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_cards_archived ON public.cards(archived);