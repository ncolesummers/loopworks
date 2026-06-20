import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { portalFixture } from "@/lib/fixtures";

export default function DeploymentsPage() {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Deployments</h1>
      <h2 className="sr-only">Deployment summary</h2>
      <DeploymentSummary deployments={portalFixture.deployments} />
    </div>
  );
}
