# Clerk + Supabase identity bridge

Nitra Space currently stores every social identity as a Supabase Auth UUID. The
database has foreign keys to `auth.users(id)` and RLS/functions based on
`auth.uid()`. Clerk IDs such as `user_...` cannot be written into those UUID
columns safely.

The application uses Clerk for the visible identity experience and a
server-only bridge for the existing Supabase data session. The custom account
screen handles e-mail/password, verification codes, Google OAuth and password
recovery through Clerk:

1. Clerk completes sign-up/sign-in, verification, password recovery or Google sign-in.
2. `/api/auth-bridge` verifies the Clerk session with `CLERK_SECRET_KEY`.
3. It links an existing Supabase user by verified e-mail, or creates a new UUID
   account only after the user completes the Nitra profile fields (16+).
4. It issues a one-time Supabase magic-link token hash. The browser exchanges it
   for the normal Supabase session used by existing RLS, Realtime and chat.

No Clerk secret or Supabase service-role key is sent to the browser. Existing
Supabase users, profiles, messages and RLS policies are preserved. No database
migration is required for this bridge.

## Required deployment settings

- Vercel Production: `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY`.
- Clerk Dashboard: enable Email + Password and Google, turn on email verification,
  make organization membership optional, and allow both `https://nitraspace.sk`
  and `https://www.nitraspace.sk`. Use `/account` for sign-in, sign-up, and OAuth
  callback URLs. Also allow the local development origin (for example
  `http://localhost:5173`).
- Do not add `CLERK_SECRET_KEY` to a `VITE_` variable.
- Existing Supabase passwords are not copied into Clerk. Existing profiles and
  data remain linked by verified e-mail and keep their original UUID; a person
  signs up or signs in with Clerk using the same e-mail address.

The Supabase native Third-Party Auth integration is intentionally not enabled
for this schema: its Clerk `sub` would make `auth.uid()` a non-UUID value and
would break existing foreign keys and policies.
