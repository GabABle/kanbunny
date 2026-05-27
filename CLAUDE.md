# Flowjoe — Claude Context

Flowjoe is a Kanban board app (think Trello). React SPA deployed to AWS via SST v4, Supabase for auth + database.

## Live URLs
- **Production**: https://d11qc1to1jay4v.cloudfront.net
- **Supabase project**: `jggqrlfwzzybvyhkjepb` (GabABle account, ap-southeast-1)
- **Supabase dashboard**: https://supabase.com/dashboard/project/jggqrlfwzzybvyhkjepb
- **GitHub repo**: https://github.com/GabABle/kanbunny

## Tech Stack
- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS v4, React Router v7, TanStack Query v5, shadcn/ui (Radix), react-hook-form + zod
- **Drag & drop**: @hello-pangea/dnd
- **Backend**: Supabase (Postgres + RLS + Auth) — direct from browser, no separate API server yet
- **Infrastructure**: SST v4 → AWS S3 + CloudFront (ap-southeast-1)
- **Package manager**: Bun
- **CI/CD**: GitHub Actions workflow exists but **does not work** (SST silently fails in CI despite AdminstratorAccess OIDC role — likely a Windows/Linux state path issue). **Deploy manually from your local machine instead.**

## Environment Variables
Injected at build time by SST from GitHub Actions secrets:
```
VITE_SUPABASE_URL=https://jggqrlfwzzybvyhkjepb.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_It-t1ZMEhvTpUYLIkx8-Yw_hVgkkLJR
VITE_SUPABASE_PROJECT_ID=jggqrlfwzzybvyhkjepb
```
Local dev: copy these into `.env` (already gitignored).

## Project Structure
```
src/
  App.tsx                        # Routes + auth guard (RequireAuth)
  main.tsx
  styles.css
  pages/
    login.tsx                    # /login
    signup.tsx                   # /signup
    invite.tsx                   # /invite/:token
    index.tsx                    # / (redirects to /boards)
    AuthLayout.tsx               # Shared layout for authed routes
    boards/
      index.tsx                  # /boards — board list
      detail.tsx                 # /boards/:boardId — kanban view
  components/
    kanban/
      CardDialog.tsx             # Card detail modal
    ui/                          # shadcn/ui components
  hooks/
    use-auth.tsx                 # Auth state (Supabase session)
    use-mobile.tsx
  integrations/
    supabase/
      client.ts                  # Supabase client (singleton proxy)
      types.ts                   # Generated DB types
  lib/
    kanban.functions.ts          # Board/list/card CRUD helpers
    invites.functions.ts         # Board invite logic
    avatar-color.ts
    utils.ts
```

## Database Schema (Supabase / Postgres)
Key tables: `profiles`, `boards`, `board_members`, `lists`, `cards`, `labels`, `card_labels`, `card_assignees`, `checklists`, `checklist_items`, `card_comments`, `card_attachments`, `card_activities`, `board_invites`

Enum: `board_role` — `owner | editor | viewer | member`

Key RLS functions: `is_board_member()`, `board_role_of()`, `can_edit_board()`, `board_of_list()`, `board_of_card()`

Auth trigger: `handle_new_user()` → creates `profiles` row on signup

Storage bucket: `card-attachments`

Migrations live in `supabase/migrations/` — always add new migrations there, never edit existing ones.

## Supabase Auth Config
- Site URL: `https://d11qc1to1jay4v.cloudfront.net`
- Redirect URLs: `https://d11qc1to1jay4v.cloudfront.net/**`
- Email confirmations: enabled

## Deployment
**Deploy locally** (GitHub Actions CI is broken — SST silently fails in Linux CI):
```bash
bunx sst deploy --stage production
```
This builds with Vite, uploads to S3, and invalidates CloudFront. Takes ~1 min.

Workflow: make changes → commit + push to `main` (for git history) → run `bunx sst deploy --stage production` locally to go live.

## Local Dev
```bash
bun install
bun run dev        # starts at http://localhost:8080
```
Requires `.env` with the three VITE_ vars above.

## Important Patterns
- Supabase client: `import { supabase } from "@/integrations/supabase/client"`
- DB types: `import type { Database } from "@/integrations/supabase/types"`
- Path alias `@/` = `src/`
- All data fetching uses TanStack Query (`useQuery` / `useMutation`)
- Toast notifications via `sonner`
- Forms via `react-hook-form` + `zod`
- **Do not use** `@lovable.dev/cloud-auth-js` for new features — it's a Lovable leftover, app works without it

## What NOT to do
- Don't push directly to `main` for large changes — use a branch + PR
- Don't edit generated files in `src/integrations/supabase/types.ts` manually — regenerate with Supabase CLI if schema changes
- Don't add `localhost` URLs to Supabase auth config — confirm links will break
- Don't use Lovable to make code changes — it will overwrite `sst.config.ts` and the deploy workflow
