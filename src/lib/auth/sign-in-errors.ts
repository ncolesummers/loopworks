import type { Status } from "@/components/ui/status-badge";

/**
 * The sign-in failure vocabulary (#214, ADR 0028), and the operator-facing copy for each value.
 *
 * Only the Auth.js error types this configuration can actually produce are listed. Everything
 * else - including the values an operator can put in the query string themselves - collapses to
 * `signInFallbackNotice`, because the proxy carries the whole original query string onto the
 * sign-in redirect and `/api/auth/error` forwards its `error` parameter verbatim. The raw
 * parameter is never rendered as visible operator copy.
 *
 * The copy states outcomes and human next steps, never mechanism: naming the allowlist, an
 * organization, or the Auth.js error type would tell an unauthorized visitor how access is
 * decided. `tests/unit/auth/sign-in-errors.test.ts` holds that line by assertion so a later copy
 * edit cannot quietly cross it.
 *
 * This module is deliberately not `"use client"`: the server component resolves the
 * attacker-controlled query value against this server-owned map, and a runtime value exported
 * from a client module reaches a server component as a client-reference proxy rather than data.
 */
export type SignInErrorNotice = Readonly<{
  detail: string;
  nextStep: string;
  status: Status;
  title: string;
}>;

export const signInErrorNotices = {
  // `callbacks.signIn` returned false. Auth.js throws `AccessDenied`, whose kind is "error".
  AccessDenied: {
    detail:
      "GitHub confirmed your identity, but this workspace has not approved this account. No session was created.",
    nextStep: "Ask the workspace operator to approve your account, then try again.",
    status: "needsApproval",
    title: "This GitHub account is not approved yet",
  },
  // The catch-all downgrade for any error @auth/core does not consider client-safe.
  Configuration: {
    detail:
      "Loopworks could not complete sign-in because of a problem on this server. Nothing about your account changed.",
    nextStep:
      "Try again in a few minutes. If it keeps failing, tell the workspace operator when you tried.",
    status: "failed",
    title: "Sign-in is unavailable right now",
  },
  // A stale post to Auth.js's own endpoint. The server action cannot produce this.
  MissingCSRF: {
    detail: "The sign-in request was stale, so Loopworks refused it and created no session.",
    nextStep: "Start the GitHub sign-in again from this page.",
    status: "blocked",
    title: "That sign-in request expired",
  },
  // An operator row already exists with the same email but a different sign-in record.
  OAuthAccountNotLinked: {
    detail:
      "A Loopworks operator already exists with the same email address but a different sign-in record.",
    nextStep:
      "Sign in with the GitHub account you used the first time, or ask the workspace operator to reconcile the two records.",
    status: "blocked",
    title: "This GitHub account is not linked to an existing operator",
  },
  // GitHub reported a problem, or the operator cancelled at GitHub.
  OAuthCallbackError: {
    detail: "The sign-in was cancelled, or GitHub could not hand the result back to Loopworks.",
    nextStep: "Start the GitHub sign-in again.",
    status: "blocked",
    title: "GitHub did not finish the sign-in",
  },
} as const satisfies Record<string, SignInErrorNotice>;

type SignInErrorCode = keyof typeof signInErrorNotices;

export const signInFallbackNotice: SignInErrorNotice = {
  detail: "Loopworks stopped the sign-in attempt and did not create a session.",
  nextStep: "Start the GitHub sign-in again.",
  status: "blocked",
  title: "Sign-in did not complete",
};

const knownCodes = new Set<string>(Object.keys(signInErrorNotices));

/**
 * Absent means no error was reported. Anything present but unrecognized - including a repeated
 * parameter, which arrives as an array - is a failure we cannot describe honestly, so it reads
 * as the generic notice rather than as nothing at all.
 */
export function resolveSignInError(
  value: string | string[] | undefined,
): SignInErrorNotice | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    return signInFallbackNotice;
  }

  return knownCodes.has(value)
    ? signInErrorNotices[value as SignInErrorCode]
    : signInFallbackNotice;
}
