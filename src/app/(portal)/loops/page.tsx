import { LoopRegistry } from "@/components/portal/dashboard-view";
import { RegisteredLoopRegistry } from "@/components/portal/registered-loop-registry";
import { db } from "@/db/client";
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
  // Both registries render their own empty state on a fresh install, so this surface declares no
  // requirement (#155) and distinguishes empty from unavailable through `emptyDetail` instead.
  const portalResult =
    result ??
    (await getPortalRecordsForPortal({
      database,
      env,
      logger: requestLogger,
      now,
      requires: [],
    }));
  const emptyDetail = portalResult.source === "unavailable" ? portalResult.error : undefined;

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Loops</h1>
      <h2 className="sr-only">Loop controls</h2>
      <RegisteredLoopRegistry
        {...(emptyDetail === undefined ? {} : { emptyDetail })}
        loops={portalResult.records.registeredLoops}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
      <LoopRegistry
        emptyDetail={
          emptyDetail ?? "Issue loops will appear after issue sync writes durable state."
        }
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
