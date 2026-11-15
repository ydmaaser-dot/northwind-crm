# Agent template

The project every agent-built site starts from: React 19, Vite, TypeScript, Tailwind CSS 3, React Router, the full shadcn/ui kit and lucide icons, plus `src/lib/img.ts` and `scripts/resolve-images.mjs` for build-time photo lookup. `AI_RULES.md` is read by the agent on every run.

## Supabase

`src/integrations/supabase/client.ts` is the app's only way to Supabase: a client built from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or the older `VITE_SUPABASE_ANON_KEY`), which ThatCode supplies when it starts the preview or builds the publication of a project with a connected Supabase project. Without one the client is `null`. Keys never belong in source. `src/integrations/supabase/types.ts` is replaced with the types Supabase generates after each database change. Edge Functions live under `supabase/functions/<name>/index.ts` as Deno code; the typecheck and the Vite build only see `src`, so they never compile it.

## Working on the app outside ThatCode

This repository is the whole app. To run it on your own machine: `npm install`, then put the connected Supabase project's two public values in `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the project's Connect dialog in the Supabase dashboard shows both), then `npm run dev`. `.env` files are never committed, and no key beyond those two belongs in the app: server keys live in the Supabase project's Edge Function secrets.

The database's history sits in `supabase/`, ready for the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

- `supabase/migrations/` holds every change ThatCode applied to the database's structure, oldest first, each naming who approved it. `supabase/seed.sql` holds the rows those changes inserted, and `src/integrations/supabase/types.ts` the types Supabase generated. ThatCode keeps all three up to date.
- `supabase init` adds the CLI's `config.toml` next to them, and `supabase start` then runs a local copy of the database with the migrations and the seed applied.
- ThatCode applied the migrations to the live project itself, so the live project's migration history does not list them. After `supabase link --project-ref <ref>`, mark them applied once with `supabase migration repair --linked --status applied <version> …` (each version is the 14 digits a file name starts with) before your first `supabase db push`, or the CLI runs them again.
- `supabase/functions/<name>/` holds the app's Edge Functions. ThatCode deploys them with Supabase's gateway check off, because each function checks its own callers; deploy them the same way with `supabase functions deploy <name> --no-verify-jwt`.
