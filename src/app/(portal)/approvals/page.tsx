import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { db } from "@/db/client";
import { createRequestLogger } from "@/lib/observability/logger";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  type PortalRecordsDatabase,
  type PortalRecordsResult,
  portalApprovalLimit,
  portalApprovalRunLimit,
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
      <p className="text-sm text-muted-foreground">
        Up to {portalApprovalLimit} gates from the {portalApprovalRunLimit} most recent runs,
        ordered by request time. Open a run for its full history.
      </p>
      {portalResult.records.approvals.length > 0 ? (
        <ul className="space-y-6" aria-label="Approval gates">
          {portalResult.records.approvals.map((approval, index) => (
            <li key={approval.id ?? index} data-approval-id={approval.id}>
              <ApprovalGatePanel
                approval={approval}
                enableActions={portalResult.source === "db"}
                sourceLabel={getPortalSourceLabel(portalResult)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ApprovalGatePanel
          approval={null}
          firstRun={deriveFirstRunState({ result: portalResult })}
          sourceLabel={getPortalSourceLabel(portalResult)}
        />
      )}
    </div>
  );
}

export default async function ApprovalsPage() {
  return <ApprovalsPageContent />;
}
