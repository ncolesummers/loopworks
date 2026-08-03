import { resolveConfigRuntimeContext, validateConfig } from "@/lib/config/registry";

export async function register() {
  // Next.js compile-time replaces this literal access; keep it direct.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  validateConfig(process.env, resolveConfigRuntimeContext(process.env));

  const [{ db }, { registerLoopworksOtel }, metrics] = await Promise.all([
    import("@/db/client"),
    import("@/lib/observability/otel"),
    import("@/lib/observability/metrics"),
  ]);

  registerLoopworksOtel();
  metrics.registerControlPlaneGaugeMetrics({
    sources: metrics.createControlPlaneGaugeSources(db),
  });
}
