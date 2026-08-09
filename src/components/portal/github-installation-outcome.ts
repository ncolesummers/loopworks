/**
 * The display-only GitHub App installation result vocabulary (ADR 0021), and the
 * operator-facing copy for each value.
 *
 * This module is deliberately not `"use client"`. The Settings server component
 * derives its query-parameter allowlist from `githubInstallationOutcomes`, and a
 * runtime value exported from a client module reaches a server component as a
 * client-reference proxy rather than the array — which fails at module
 * evaluation, not at type-check.
 */
export type GithubInstallationOutcome =
  | "already-connected"
  | "cancelled"
  | "connected"
  | "error"
  | "no-installation-found"
  | "pending-approval";

export const githubInstallationOutcomeCopy: Record<GithubInstallationOutcome, string> = {
  "already-connected": "That GitHub App installation is already connected.",
  cancelled: "GitHub App installation was cancelled. No connection was saved.",
  connected: "GitHub App installation connected successfully.",
  error: "GitHub App installation could not be verified. Start a new connection attempt.",
  // GitHub lists an installation only when the signed-in operator has access to
  // it, so an empty result can mean it is not installed *or* that this operator
  // cannot see it. Naming both keeps the copy truthful; naming only the first
  // would send an operator back to the install link that already dead-ends (#151).
  "no-installation-found":
    "No GitHub App installation was visible to your GitHub account. Either the Loopworks GitHub App is not installed on that account yet, or your account cannot access the installation — an organization owner can install it or grant you access.",
  "pending-approval": "GitHub is waiting for an organization owner to approve this installation.",
};

/**
 * Settings derives its allowlist from this, so an outcome can never gain copy
 * above yet be dropped before it reaches the surface.
 */
export const githubInstallationOutcomes = Object.keys(
  githubInstallationOutcomeCopy,
) as GithubInstallationOutcome[];
