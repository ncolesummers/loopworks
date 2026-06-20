const truthyValues = new Set(["1", "true", "yes", "on"]);

export function isTruthyEnvValue(value: string | undefined): boolean {
  return truthyValues.has((value ?? "").trim().toLowerCase());
}

export function isProductionRuntime(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}
