-- ============================================================
-- Agent schema: PM Agent + SWE Agent
-- ============================================================

-- ── 1. Extend cards with AI metadata columns ─────────────────
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS ai_priority   SMALLINT CHECK (ai_priority BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS ai_urgency    SMALLINT CHECK (ai_urgency BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS agent_status  TEXT NOT NULL DEFAULT 'idle'
    CHECK (agent_status IN ('idle','in_progress','blocked','done'));

-- ── 2. card_ai_meta ──────────────────────────────────────────
-- Stores PM-agent evaluations (one current row per card;
-- history kept in agent_runs).
CREATE TABLE IF NOT EXISTS public.card_ai_meta (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  priority_score  SMALLINT NOT NULL CHECK (priority_score BETWEEN 1 AND 5),
  urgency_score   SMALLINT NOT NULL CHECK (urgency_score  BETWEEN 1 AND 5),
  rationale       TEXT,
  evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_by    TEXT NOT NULL DEFAULT 'agent' -- 'agent' | 'user'
);

-- Only one meta row per card (upsert target)
CREATE UNIQUE INDEX IF NOT EXISTS card_ai_meta_card_id_idx ON public.card_ai_meta (card_id);

ALTER TABLE public.card_ai_meta ENABLE ROW LEVEL SECURITY;

-- Board members can read AI meta for cards they can see
CREATE POLICY "Read card ai meta" ON public.card_ai_meta
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cards c
      JOIN public.lists l ON l.id = c.list_id
      WHERE c.id = card_id
        AND public.is_board_member(l.board_id, auth.uid())
    )
  );

-- Editors/owners can insert/update AI meta
CREATE POLICY "Write card ai meta" ON public.card_ai_meta
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cards c
      JOIN public.lists l ON l.id = c.list_id
      WHERE c.id = card_id
        AND public.can_edit_board(l.board_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cards c
      JOIN public.lists l ON l.id = c.list_id
      WHERE c.id = card_id
        AND public.can_edit_board(l.board_id, auth.uid())
    )
  );

-- ── 3. agent_runs ─────────────────────────────────────────────
-- One row per agent invocation. Tracks state + append-only log.
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  card_id     UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  agent_type  TEXT NOT NULL CHECK (agent_type IN ('pm', 'swe')),
  status      TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','paused','done','halted','error')),
  started_by  UUID NOT NULL REFERENCES auth.users(id),
  log         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Board members can read runs for their boards
CREATE POLICY "Read agent runs" ON public.agent_runs
  FOR SELECT TO authenticated
  USING (public.is_board_member(board_id, auth.uid()));

-- Editors/owners can create runs
CREATE POLICY "Create agent runs" ON public.agent_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_board(board_id, auth.uid())
    AND auth.uid() = started_by
  );

-- Only the starter can update (pause/halt/complete their own run)
CREATE POLICY "Update own agent runs" ON public.agent_runs
  FOR UPDATE TO authenticated
  USING (auth.uid() = started_by);

-- ── 4. Helper: auto-update agent_runs.updated_at ─────────────
CREATE OR REPLACE FUNCTION public.set_agent_runs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_runs_updated_at ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_runs_updated_at();

-- ── 5. Helper: board_id_of_card ───────────────────────────────
-- Convenience function used by edge functions + RLS helpers.
CREATE OR REPLACE FUNCTION public.board_id_of_card(_card_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.board_id
  FROM public.cards c
  JOIN public.lists l ON l.id = c.list_id
  WHERE c.id = _card_id;
$$;
