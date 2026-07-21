import { isProductionRuntime } from "@/lib/runtime";

type RunUrlEnvironment = Record<string, string | undefined>;

function configuredLoopworksOrigin(env: RunUrlEnvironment): URL {
  const configured =
    env.LOOPWORKS_PUBLIC_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : env.VERCEL_URL
        ? `https://${env.VERCEL_URL}`
        : "http://127.0.0.1:3000");
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("LOOPWORKS_PUBLIC_URL must be an absolute Loopworks origin.");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !["http:", "https:"].includes(origin.protocol)
  ) {
    throw new Error("LOOPWORKS_PUBLIC_URL must be an origin without credentials or a path.");
  }
  if (isProductionRuntime(env) && origin.protocol !== "https:") {
    throw new Error("Production Loopworks run URLs require an HTTPS public origin.");
  }
  return origin;
}

export function canonicalLoopworksRunUrl(
  runId: string,
  env: RunUrlEnvironment = process.env,
): string {
  const url = new URL("/runs", configuredLoopworksOrigin(env));
  url.searchParams.set("run", runId);
  return url.toString();
}

export function assertCanonicalLoopworksRunUrl(
  runId: string,
  candidate: string,
  env: RunUrlEnvironment = process.env,
): string {
  let normalized: string;
  try {
    normalized = new URL(candidate).toString();
  } catch {
    throw new Error("PR preparation requires the canonical Loopworks run URL.");
  }
  const expected = canonicalLoopworksRunUrl(runId, env);
  if (normalized !== expected) {
    throw new Error("PR preparation requires the canonical Loopworks run URL.");
  }
  return expected;
}
