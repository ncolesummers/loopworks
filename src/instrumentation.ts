export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

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
