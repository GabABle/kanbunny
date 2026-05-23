# Trello Clone — Kanban App

A modern, minimal (Linear-style) collaborative kanban board built on TanStack Start + Lovable Cloud.

## Stack
- TanStack Start (routes, server fns), TanStack Query
- Lovable Cloud (Postgres + Auth) — email/password + Google sign-in
- `@dnd-kit` for drag & drop (lists + cards)
- Tailwind + shadcn/ui, dark Linear-inspired theme

## Database Schema
- `profiles` (id → auth.users, display_name, avatar_url)
- `boards` (id, owner_id, title, description, created_at)
- `board_members` (board_id, user_id, role: owner/editor/viewer) — controls access
- `lists` (id, board_id, title, position)
- `cards` (id, list_id, title, description, position, due_date, created_at)
- `labels` (id, board_id, name, color)
- `card_labels` (card_id, label_id)
- `card_assignees` (card_id, user_id)
- `checklists` (id, card_id, title, position)
- `checklist_items` (id, checklist_id, text, done, position)
- `user_roles` (separate table, app_role enum) for any admin features

RLS on every table via `has_board_access(board_id, user_id)` security-definer function (avoids recursion).

## Routes
```
src/routes/
  __root.tsx              auth listener, query invalidation
  index.tsx               marketing landing (public)
  login.tsx               email/password + Google
  signup.tsx
  _authenticated.tsx      gate: redirect to /login if no session
  _authenticated/
    boards.tsx            board list + "New board"
    boards.$boardId.tsx   kanban view (lists + cards, DnD)
    settings.tsx          profile
```

## Server Functions (`requireSupabaseAuth`)
- `listBoards`, `createBoard`, `deleteBoard`, `renameBoard`
- `getBoard(boardId)` → lists + cards + labels + members
- `createList`, `renameList`, `deleteList`, `reorderLists`
- `createCard`, `updateCard`, `deleteCard`, `moveCard` (list + position)
- `addLabel`, `removeLabel`, `assignMember`, `unassignMember`
- `addChecklist`, `addChecklistItem`, `toggleChecklistItem`
- `inviteMember(boardId, email, role)` — looks up user by email, inserts into `board_members`
- `removeMember`, `updateMemberRole`

## Drag & Drop
- `@dnd-kit/core` + `@dnd-kit/sortable`
- Fractional positions (e.g., halve gap between neighbors) to avoid full reorder writes
- Optimistic updates via TanStack Query mutations + cache patch; rollback on error

## Card Detail Modal
Dialog opened from card click. Contains: description (markdown-ish textarea), due date picker, labels multi-select, assignees, checklists. All mutations optimistic.

## Collaboration
- Invite by email → must be existing registered user (show toast if not found)
- Member list panel in board settings drawer
- Roles: owner (full), editor (modify content), viewer (read-only) — enforced by RLS + UI

## Design (Linear-style, dark)
- Tokens in `src/styles.css`: deep slate background, subtle borders, single accent (indigo/violet), tight typography (Inter)
- Sidebar with boards, sparse top bar, dense card spacing, no heavy shadows
- Subtle hover states, keyboard shortcuts (N = new card, / = search)

## Build Order
1. Enable Lovable Cloud + auth (email/password + Google)
2. Create schema + RLS + `has_board_access` function + profile trigger
3. Design system tokens + base layout (sidebar shell)
4. Auth pages + `_authenticated` gate + root auth listener
5. Boards list page + create/delete
6. Board view: lists + cards (no DnD yet)
7. Add `@dnd-kit` drag & drop with optimistic moves
8. Card detail modal: description, due date, labels, assignees, checklists
9. Member invite + roles
10. Polish: empty states, loading skeletons, error boundaries, keyboard shortcuts

## Out of Scope (v1)
Real-time sync (can add via Supabase Realtime later), comments/activity log, attachments, board templates, archived cards.
