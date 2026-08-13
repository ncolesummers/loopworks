const truthyValues = new Set(["1", "true", "yes", "on"]);

export function isTruthyEnvValue(value: string | undefined): boolean {
  return truthyValues.has((value ?? "").trim().toLowerCase());
}

export function isProductionRuntime(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * A Vercel Preview deployment, which `isProductionRuntime` also reports true for:
 * previews build with `NODE_ENV=production`.
 *
 * Only checks worth binding to one specific database should use this to opt out.
 * Preview databases are provider-owned and change with the Preview lifecycle
 * (ADR 0018), so a project-level variable cannot name the store a given preview
 * will actually be handed.
 */
export function isPreviewRuntime(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}
