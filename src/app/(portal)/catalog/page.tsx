import { db } from "@/db/client";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { createRequestLogger } from "@/lib/observability/logger";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  type PortalRecordsDatabase,
  type PortalRecordsResult,
} from "@/lib/portal/records";

export async function CatalogPageContent({
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
    route: "portal.catalog",
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
      <h1 className="sr-only">Catalog</h1>
      <h2 className="sr-only">Catalog summary</h2>
      <RepoCatalog
        emptyDetail={emptyDetail}
        repos={portalResult.records.repos}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
    </div>
  );
}

export default async function CatalogPage() {
  return <CatalogPageContent />;
}
