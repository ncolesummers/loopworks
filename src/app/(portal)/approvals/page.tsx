import { db } from "@/db/client";
import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { createRequestLogger } from "@/lib/observability/logger";
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
  const portalResult =
    result ??
    (await getPortalRecordsForPortal({
      database,
      env,
      logger: requestLogger,
      now,
    }));
  const emptyDetail = portalResult.source === "unavailable" ? portalResult.error : undefined;

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Approvals</h1>
      <h2 className="sr-only">Approval state</h2>
      <ApprovalGatePanel
        approval={portalResult.records.approval}
        emptyDetail={emptyDetail}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
    </div>
  );
}

export default async function ApprovalsPage() {
  return <ApprovalsPageContent />;
}
