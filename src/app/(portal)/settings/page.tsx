import {
  GitHubSettingsView,
  type GithubInstallationOutcome,
} from "@/components/portal/github-settings-view";
import { db } from "@/db/client";
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
  installationOutcome,
  now,
  result,
}: Readonly<{
  database?: PortalRecordsDatabase;
  env?: Partial<NodeJS.ProcessEnv>;
  installationOutcome?: GithubInstallationOutcome;
  now?: Date;
  result?: PortalRecordsResult;
}> = {}) {
  const requestLogger = createRequestLogger({
    route: "portal.settings",
  });
  // Settings must render the connect-the-App action on an empty install, so it
  // declares no requirement (#155).
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
    <GitHubSettingsView
      emptyDetail={emptyDetail}
      githubInstallations={portalResult.records.githubInstallations}
      installationOutcome={installationOutcome}
      readOnly={portalResult.source !== "fixtures"}
      settings={portalResult.records.githubSettings}
      sourceLabel={getPortalSourceLabel(portalResult)}
    />
  );
}

const installationOutcomes = new Set<GithubInstallationOutcome>([
  "already-connected",
  "cancelled",
  "connected",
  "error",
  "pending-approval",
]);

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams?: Promise<{ github?: string | string[] }>;
}>) {
  const github = (await searchParams)?.github;
  const outcome =
    typeof github === "string" && installationOutcomes.has(github as GithubInstallationOutcome)
      ? (github as GithubInstallationOutcome)
      : undefined;
  return <SettingsPageContent installationOutcome={outcome} />;
}
