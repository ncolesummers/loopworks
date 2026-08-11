"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { authPages } from "@/lib/auth/pages";
import { isGithubAuthorizationUrl, readSignInCallbackUrl } from "@/lib/auth/sign-in-action-input";
import { resolveSignInRedirect } from "@/lib/auth/sign-in-redirect";

/**
 * Start the GitHub authorization handshake (#214).
 *
 * Every export of a `"use server"` module is a public endpoint, so the submitted `callbackUrl` is
 * re-sanitized here even though the page already sanitized what it rendered: the hidden field is
 * client-controlled regardless of what we put in it.
 *
 * `redirect: false` is deliberate. Auth.js's own redirect path rethrows an `AuthError`, so a
 * misconfigured server would escape this action as an unhandled error and become a 500 rather
 * than the readable state this issue exists to provide - and catching around a redirecting call
 * would instead swallow `NEXT_REDIRECT`. Asking for the URL and redirecting separately keeps
 * `redirect()` outside the `try` and makes both failure modes impossible.
 */
export async function startGithubSignIn(formData: FormData): Promise<never> {
  const redirectTo = resolveSignInRedirect(readSignInCallbackUrl(formData));

  let authorizationUrl: unknown;
  try {
    authorizationUrl = await signIn("github", { redirect: false, redirectTo });
  } catch {
    // @auth/core has already logged the concrete error. Nothing about it reaches the operator
    // beyond the mapped code.
    redirect(`${authPages.error}?error=Configuration`);
  }

  if (typeof authorizationUrl !== "string" || !isGithubAuthorizationUrl(authorizationUrl)) {
    redirect(`${authPages.error}?error=Configuration`);
  }

  /*
    Typed routes describe this app's own routes, and this one deliberately leaves it. The cast
    asserts something the guard above just checked at runtime - an https URL on GitHub's
    authorization host - rather than something assumed.
  */
  redirect(authorizationUrl as Route);
}
