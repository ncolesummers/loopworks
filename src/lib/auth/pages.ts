/**
 * The app-owned Auth.js page routes (#214, ADR 0028).
 *
 * `error` deliberately aliases `signIn`. Auth.js picks an error's destination from its `kind`,
 * and `AccessDenied` - the allowlist denial thrown when `callbacks.signIn` returns false -
 * extends `AuthError` rather than `SignInError`, so it inherits `kind: "error"` and routes
 * through `pages.error`. Pointing `error` anywhere else would send the single most important
 * state this surface renders to Auth.js's own page with the raw code on screen.
 *
 * Both values live here rather than inline in `src/auth.ts` so the coupling is one import and
 * one assertion instead of a comment nobody re-reads.
 */
export const authPages = {
  error: "/sign-in",
  signIn: "/sign-in",
} as const;
