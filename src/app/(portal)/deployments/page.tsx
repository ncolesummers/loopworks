import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { portalFixture } from "@/lib/fixtures";
import { createRequestLogger } from "@/lib/observability/logger";
import { createVercelDeploymentClient } from "@/lib/vercel/client";
import {
  getDeploymentRecordsForResult,
  getDeploymentSourceLabel,
} from "@/lib/vercel/deployment-record";

const defaultProjectId = portalFixture.repos.find((repo) => repo.vercelProjectId)?.vercelProjectId;

export default async function DeploymentsPage() {
  const requestLogger = createRequestLogger({
    route: "portal.deployments",
  });
  const client = createVercelDeploymentClient({
    accessToken: process.env.VERCEL_ACCESS_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    teamSlug: process.env.VERCEL_TEAM_SLUG,
    logger: requestLogger,
  });
  const result = await client.listDeployments({
    projectId: defaultProjectId,
    limit: 20,
  });
  const deployments = getDeploymentRecordsForResult(result, portalFixture.deployments);

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Deployments</h1>
      <h2 className="sr-only">Deployment summary</h2>
      <DeploymentSummary
        deployments={deployments}
        sourceLabel={getDeploymentSourceLabel(result)}
        emptyDetail={
          result.error ?? "Deployment and preview records will appear after Vercel sync."
        }
      />
    </div>
  );
}
