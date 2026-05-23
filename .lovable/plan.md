## Fix: signup feels like nothing happens

**Root cause:** email verification is on, so `signUp` succeeds but the user isn't signed in. The success toast appears briefly then the form clears — looks like nothing happened.

## Changes

1. Enable auto-confirm on email signups in Lovable Cloud auth settings.
2. In `src/routes/signup.tsx`, after successful `signUp`:
   - if `data.session` exists, navigate to `/boards`
   - else fall back to `signInWithPassword` then navigate
3. Same treatment in `src/routes/login.tsx` if needed (navigate on success).

No DB changes, no UI redesign.