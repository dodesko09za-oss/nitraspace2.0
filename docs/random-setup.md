# Nitra Space RANDOM

RANDOM is a separate page at `/random`. Sign-in is through the existing Clerk account flow. Supabase remains the database and uses the existing server-side Clerk-to-Supabase bridge to map Clerk identities onto the UUID users required by the current database and RLS model. Random matching does not reveal e-mail, username, profile photos, or public profile data.

## Safe local preview

The repository has existing migration files but no `supabase/config.toml` or complete baseline for rebuilding the existing database. For an isolated preview, use a **separate development Supabase project** (or an empty disposable project), never the production project.

1. Confirm the local app has `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the existing server-side `SUPABASE_SERVICE_ROLE_KEY`. Keep the secret and service-role keys server-only; only Vite variables are public.
2. In the development project's SQL Editor, run `supabase/migrations/20261122142912_nitra_space_random.sql`.
3. **Do not enable Supabase Anonymous sign-ins for RANDOM.** Clerk login is required. The signed-in Clerk session is exchanged by `/api/auth-bridge` for the existing Supabase UUID session; the server marks that user in protected `app_metadata`, which the migration checks before allowing matching or chat RPCs.
4. Start the Vite app with `npm run dev -- --host 127.0.0.1 --port 5178` and open `http://127.0.0.1:5178/random` (use the port Vite reports if 5178 is already occupied).
5. Sign in with the normal Nitra Space Clerk account. Open a second browser session with a different Clerk account and compatible age/intent settings to exercise match consent, realtime chat, next, block, and report. The waiting count comes from the development database and includes only fresh queued sessions.

The migration is a local file only. It has not been applied to any Supabase project, and no deployment has been run.

## Database and access model

- `random_private.profiles`, `sessions`, `queue`, `matches`, `pair_history`, `blocks`, `reports`, and `prompts` are in an unexposed schema with no client table grants.
- `public.random_messages` and `public.random_typing` are the only public-schema data tables. RLS permits reads only for participants in an accepted chat. Writes go through narrowly scoped RPCs.
- All user-specific RANDOM RPCs require an authenticated Supabase UUID whose signed-in Clerk identity was verified by the server bridge. Public daily challenge and waiting-count RPCs return only aggregate/public content.
- Matching enforces mutual age ranges, same-intent matching, separation of 16–17-year-olds from adults, self-match prevention, blocked-pair exclusion, and a 24-hour repeat-pair cooldown.
- Realtime publication membership for chat tables is added by the migration when `supabase_realtime` exists. No project-wide Realtime access setting is changed.

## Before a public launch

- Apply and review the migration against the intended project only when explicitly ready; this work did not connect to or alter production.
- Ensure the existing Clerk/Supabase bridge environment variables are configured on the hosting platform. Never expose `CLERK_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in the browser.
- Configure Clerk abuse protection and rate limits appropriate to expected traffic.
- Plan retention and cleanup for inactive RANDOM profiles and stored chat messages.
- Reports are written privately to `random_private.reports`; there is no moderator review screen yet. Add a trusted moderation workflow before relying on reports for a public launch.
- Ages are self-reported. The database keeps users aged 16–17 in a friends-only pool separate from adults, but age is not independently verified. Add age assurance and moderation safeguards before opening to the public.
