import { RepoCatalog } from "@/components/portal/repo-catalog";
import { db } from "@/db/client";
import { createRequestLogger } from "@/lib/observability/logger";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
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
  // The catalog renders its own first-run empty state when nothing is selected, so it
  // must not require loops, deployments, or an approval to exist (#155).
  const portalResult =
    result ??
    (await getPortalRecordsForPortal({
      database,
      env,
      logger: requestLogger,
      now,
      requires: [],
    }));
  // ADR 0019: derive the first-run state server-side per read, so an empty catalog can name the
  // activation step the operator is actually on and a failed read names none.
  const firstRun = deriveFirstRunState({ result: portalResult });

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Catalog</h1>
      <h2 className="sr-only">Catalog summary</h2>
      <RepoCatalog
        firstRun={firstRun}
        repos={portalResult.records.repos}
        sourceLabel={getPortalSourceLabel(portalResult)}
      />
    </div>
  );
}

export default async function CatalogPage() {
  return <CatalogPageContent />;
}
