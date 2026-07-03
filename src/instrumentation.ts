export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerLoopworksOtel } = await import("@/lib/observability/otel");
  registerLoopworksOtel();
}
