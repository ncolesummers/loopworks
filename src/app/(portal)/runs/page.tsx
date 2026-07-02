import { db } from "@/db/client";
import { RunRecordsView } from "@/components/portal/run-records-view";
import { createRequestLogger } from "@/lib/observability/logger";
import { buildRunFixtureRecords } from "@/lib/runs/fixtures";
import {
  getRunRecordsForPortal,
  getRunRecordsForResult,
  getRunSourceLabel,
  type RunRecordDatabase,
} from "@/lib/runs/run-record";

export async function RunsPageContent({
  database = db,
  env = process.env,
}: Readonly<{
  database?: RunRecordDatabase;
  env?: Partial<NodeJS.ProcessEnv>;
}> = {}) {
  const requestLogger = createRequestLogger({
    route: "portal.runs",
  });
  const fixtureRuns = buildRunFixtureRecords();
  const result = await getRunRecordsForPortal({
    database,
    env,
    fixtureRuns,
    logger: requestLogger,
  });
  const runs = getRunRecordsForResult(result, fixtureRuns);

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Runs</h1>
      <h2 className="sr-only">Run history</h2>
      <RunRecordsView
        runs={runs}
        sourceLabel={getRunSourceLabel(result)}
        emptyDetail={result.source === "unavailable" ? result.error : undefined}
      />
    </div>
  );
}

export default async function RunsPage() {
  return <RunsPageContent />;
}
