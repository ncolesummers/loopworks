import Link from "next/link";

import { LoopRegistrationRefresher } from "@/components/portal/loop-registration-refresher";
import { Button } from "@/components/ui/button";
import { readSuppliedRawConfig } from "@/lib/config/registry";
import { loopRegistrationFixture } from "@/lib/fixtures";
import type { LoopRegistrationSnapshot } from "@/lib/loops/loop-registration-flow";
import { createLoopRegistrationRuntime } from "@/lib/loops/loop-registration-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { isProductionRuntime } from "@/lib/runtime";

function LoopRegistrationSurface({
  fixtureMode = false,
  snapshot,
}: Readonly<{ fixtureMode?: boolean; snapshot: LoopRegistrationSnapshot }>) {
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Loops</div>
          <h1 className="text-2xl font-semibold tracking-tight">Register a loop</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Register a loop contract against a tracked repository. Registered loops appear in the
            loop registry with their triggers, validation gates, and approval requirements.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/loops">Back to loops</Link>
        </Button>
      </section>

      <LoopRegistrationRefresher fixtureMode={fixtureMode} snapshot={snapshot} />
    </div>
  );
}

export async function LoopRegistrationPageContent({
  env = process.env,
  readRegistration,
}: Readonly<{
  env?: Partial<NodeJS.ProcessEnv>;
  readRegistration?: () => Promise<LoopRegistrationSnapshot>;
}> = {}) {
  // Explicit, non-production fixture mode only; it must never stand in for a failed real read.
  if (
    !isProductionRuntime(env) &&
    readSuppliedRawConfig("LOOPWORKS_PORTAL_DATA_MODE", env) === "fixtures"
  ) {
    return <LoopRegistrationSurface fixtureMode snapshot={loopRegistrationFixture} />;
  }

  let snapshot: LoopRegistrationSnapshot;
  try {
    snapshot = await (
      readRegistration ?? (() => createLoopRegistrationRuntime().readRegistration())
    )();
  } catch (error) {
    // Configuration and runtime construction failures must not blank the page; the operator still
    // needs the surrounding surface and its route back to the registry.
    createRequestLogger({ route: "portal.loops.register" }).warn(
      { reason: error instanceof Error ? error.message : "unknown" },
      "loop_registration_read_failed",
    );
    snapshot = { reason: "loop_registration_unavailable", status: "error" };
  }

  return <LoopRegistrationSurface snapshot={snapshot} />;
}

export default async function LoopRegistrationPage() {
  return <LoopRegistrationPageContent />;
}
