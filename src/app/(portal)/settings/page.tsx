import { db } from "@/db/client";
import { GitHubSettingsView } from "@/components/portal/github-settings-view";
import { createRequestLogger } from "@/lib/observability/logger";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  type PortalRecordsDatabase,
  type PortalRecordsResult,
} from "@/lib/portal/records";

export async function SettingsPageContent({
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
    route: "portal.settings",
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
    <GitHubSettingsView
      emptyDetail={emptyDetail}
      readOnly={portalResult.source !== "fixtures"}
      settings={portalResult.records.githubSettings}
      sourceLabel={getPortalSourceLabel(portalResult)}
    />
  );
}

export default async function SettingsPage() {
  return <SettingsPageContent />;
}
