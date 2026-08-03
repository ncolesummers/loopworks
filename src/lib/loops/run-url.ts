import { readSuppliedRawConfig } from "@/lib/config/registry";
import { parseLoopworksPublicOrigin } from "@/lib/public-origin";

type RunUrlEnvironment = Record<string, string | undefined>;

function configuredLoopworksOrigin(env: RunUrlEnvironment): URL {
  const configured =
    readSuppliedRawConfig("LOOPWORKS_PUBLIC_URL", env) ??
    (readSuppliedRawConfig("VERCEL_PROJECT_PRODUCTION_URL", env)
      ? `https://${readSuppliedRawConfig("VERCEL_PROJECT_PRODUCTION_URL", env)}`
      : readSuppliedRawConfig("VERCEL_URL", env)
        ? `https://${readSuppliedRawConfig("VERCEL_URL", env)}`
        : "http://127.0.0.1:3000");
  return parseLoopworksPublicOrigin(configured, env);
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
