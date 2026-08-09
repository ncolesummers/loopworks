import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { db } from "@/db/client";
import { createRequestLogger } from "@/lib/observability/logger";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  type PortalRecordsDatabase,
  type PortalRecordsResult,
} from "@/lib/portal/records";

export async function ApprovalsPageContent({
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
    route: "portal.approvals",
  });
  // An install with no approval gate yet is a normal empty state, not an outage
  // (#155).
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
    <div className="space-y-6">
      <h1 className="sr-only">Approvals</h1>
      <h2 className="sr-only">Approval state</h2>
      <ApprovalGatePanel
        approval={portalResult.records.approval}
        firstRun={deriveFirstRunState({ result: portalResult })}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
    </div>
  );
}

export default async function ApprovalsPage() {
  return <ApprovalsPageContent />;
}
