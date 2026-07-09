import { db } from "@/db/client";
import { LoopRegistry } from "@/components/portal/dashboard-view";
import { createRequestLogger } from "@/lib/observability/logger";
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
      <h1 className="sr-only">Loops</h1>
      <h2 className="sr-only">Loop controls</h2>
      <LoopRegistry
        emptyDetail={emptyDetail}
        loops={portalResult.records.loops}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
    </div>
  );
}

export default async function LoopsPage() {
  return <LoopsPageContent />;
}
