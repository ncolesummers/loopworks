import { DashboardView } from "@/components/portal/dashboard-view";
import { db } from "@/db/client";
import { createRequestLogger } from "@/lib/observability/logger";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  type PortalRecordsDatabase,
  type PortalRecordsResult,
} from "@/lib/portal/records";

export async function DashboardPageContent({
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
    route: "portal.dashboard",
  });
  // The dashboard renders a per-panel empty state for every collection, so a
  // fresh install must reach it rather than fail closed (#155).
  const portalResult =
    result ??
    (await getPortalRecordsForPortal({
      database,
      env,
      logger: requestLogger,
      now,
      requires: [],
    }));
  return (
    <DashboardView
      firstRun={deriveFirstRunState({ result: portalResult })}
      records={portalResult.records}
      sourceLabel={getPortalSourceLabel(portalResult)}
    />
  );
}

export default async function Page() {
  return <DashboardPageContent />;
}
