import { LoopRegistry } from "@/components/portal/dashboard-view";
import { RegisteredLoopRegistry } from "@/components/portal/registered-loop-registry";
import { db } from "@/db/client";
import { createRequestLogger } from "@/lib/observability/logger";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  type PortalRecordsDatabase,
  type PortalRecordsResult,
} from "@/lib/portal/records";

export async function LoopsPageContent({
  database = db,
  env = process.env,
  now,
  result,
}: Readonly<{
  database?: PortalRecordsDatabase;
  env?: Partial<NodeJS.ProcessEnv>;
  now?: Date;
  result?: PortalRecordsResult;
}> = {}) {
  const requestLogger = createRequestLogger({
    route: "portal.loops",
  });
  // Both registries render their own empty state on a fresh install, so this surface declares no
  // requirement (#155) and distinguishes empty from unavailable through the first-run state.
  const portalResult =
    result ??
    (await getPortalRecordsForPortal({
      database,
      env,
      logger: requestLogger,
      now,
      requires: [],
    }));
  const firstRun = deriveFirstRunState({ result: portalResult });

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Loops</h1>
      <h2 className="sr-only">Loop controls</h2>
      <RegisteredLoopRegistry
        firstRun={firstRun}
        loops={portalResult.records.registeredLoops}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
      <LoopRegistry
        // Synced issue rows are a GitHub mirror, not an activation step, so this registry names
        // no onboarding stage; it only distinguishes a real absence from a failed read.
        firstRun={firstRun}
        heading="Synced issue loops"
        loops={portalResult.records.loops}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
    </div>
  );
}

export default async function LoopsPage() {
  return <LoopsPageContent />;
}
