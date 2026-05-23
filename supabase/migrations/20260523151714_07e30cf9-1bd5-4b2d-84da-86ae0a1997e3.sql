
-- Enums
CREATE TYPE public.board_role AS ENUM ('owner', 'editor', 'viewer');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read profiles (needed for member lookups / display)
CREATE POLICY "Profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Boards
CREATE TABLE public.boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

-- Board members
CREATE TABLE public.board_members (
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.board_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (avoid recursion)
CREATE OR REPLACE FUNCTION public.is_board_member(_board_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.board_members WHERE board_id = _board_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.boards WHERE id = _board_id AND owner_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.board_role_of(_board_id UUID, _user_id UUID)
RETURNS public.board_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.boards WHERE id = _board_id AND owner_id = _user_id) THEN 'owner'::public.board_role
    ELSE (SELECT role FROM public.board_members WHERE board_id = _board_id AND user_id = _user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_edit_board(_board_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.board_role_of(_board_id, _user_id) IN ('owner','editor');
$$;

-- Boards policies
CREATE POLICY "View accessible boards" ON public.boards
  FOR SELECT TO authenticated USING (public.is_board_member(id, auth.uid()));
CREATE POLICY "Create own boards" ON public.boards
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner updates board" ON public.boards
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner deletes board" ON public.boards
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Board members policies
CREATE POLICY "View members of accessible boards" ON public.board_members
  FOR SELECT TO authenticated USING (public.is_board_member(board_id, auth.uid()));
CREATE POLICY "Owner manages members" ON public.board_members
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.boards WHERE id = board_id AND owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.boards WHERE id = board_id AND owner_id = auth.uid()));

-- Auto-add owner as member trigger
CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.board_members (board_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_board_created
  AFTER INSERT ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- Lists
CREATE TABLE public.lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
CREATE INDEX lists_board_position_idx ON public.lists(board_id, position);

CREATE POLICY "View lists" ON public.lists
  FOR SELECT TO authenticated USING (public.is_board_member(board_id, auth.uid()));
CREATE POLICY "Edit lists" ON public.lists
  FOR ALL TO authenticated
  USING (public.can_edit_board(board_id, auth.uid()))
  WITH CHECK (public.can_edit_board(board_id, auth.uid()));

-- Cards
CREATE TABLE public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  position DOUBLE PRECISION NOT NULL,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE INDEX cards_list_position_idx ON public.cards(list_id, position);

CREATE OR REPLACE FUNCTION public.board_of_list(_list_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT board_id FROM public.lists WHERE id = _list_id;
$$;

CREATE POLICY "View cards" ON public.cards
  FOR SELECT TO authenticated USING (public.is_board_member(public.board_of_list(list_id), auth.uid()));
CREATE POLICY "Edit cards" ON public.cards
  FOR ALL TO authenticated
  USING (public.can_edit_board(public.board_of_list(list_id), auth.uid()))
  WITH CHECK (public.can_edit_board(public.board_of_list(list_id), auth.uid()));

-- Labels
CREATE TABLE public.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View labels" ON public.labels
  FOR SELECT TO authenticated USING (public.is_board_member(board_id, auth.uid()));
CREATE POLICY "Edit labels" ON public.labels
  FOR ALL TO authenticated
  USING (public.can_edit_board(board_id, auth.uid()))
  WITH CHECK (public.can_edit_board(board_id, auth.uid()));

CREATE TABLE public.card_labels (
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);
ALTER TABLE public.card_labels ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.board_of_card(_card_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.board_of_list(list_id) FROM public.cards WHERE id = _card_id;
$$;

CREATE POLICY "View card labels" ON public.card_labels
  FOR SELECT TO authenticated USING (public.is_board_member(public.board_of_card(card_id), auth.uid()));
CREATE POLICY "Edit card labels" ON public.card_labels
  FOR ALL TO authenticated
  USING (public.can_edit_board(public.board_of_card(card_id), auth.uid()))
  WITH CHECK (public.can_edit_board(public.board_of_card(card_id), auth.uid()));

-- Card assignees
CREATE TABLE public.card_assignees (
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
ALTER TABLE public.card_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View assignees" ON public.card_assignees
  FOR SELECT TO authenticated USING (public.is_board_member(public.board_of_card(card_id), auth.uid()));
CREATE POLICY "Edit assignees" ON public.card_assignees
  FOR ALL TO authenticated
  USING (public.can_edit_board(public.board_of_card(card_id), auth.uid()))
  WITH CHECK (public.can_edit_board(public.board_of_card(card_id), auth.uid()));

-- Checklists
CREATE TABLE public.checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View checklists" ON public.checklists
  FOR SELECT TO authenticated USING (public.is_board_member(public.board_of_card(card_id), auth.uid()));
CREATE POLICY "Edit checklists" ON public.checklists
  FOR ALL TO authenticated
  USING (public.can_edit_board(public.board_of_card(card_id), auth.uid()))
  WITH CHECK (public.can_edit_board(public.board_of_card(card_id), auth.uid()));

CREATE TABLE public.checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  position DOUBLE PRECISION NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.board_of_checklist(_checklist_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.board_of_card(card_id) FROM public.checklists WHERE id = _checklist_id;
$$;

CREATE POLICY "View checklist items" ON public.checklist_items
  FOR SELECT TO authenticated USING (public.is_board_member(public.board_of_checklist(checklist_id), auth.uid()));
CREATE POLICY "Edit checklist items" ON public.checklist_items
  FOR ALL TO authenticated
  USING (public.can_edit_board(public.board_of_checklist(checklist_id), auth.uid()))
  WITH CHECK (public.can_edit_board(public.board_of_checklist(checklist_id), auth.uid()));
