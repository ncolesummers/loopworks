import { TimelineAndArtifacts } from "@/components/portal/dashboard-view";
import { FixtureGatedPage } from "@/components/portal/fixture-gated-page";

export default function RunsPage() {
  return (
    <FixtureGatedPage area="Runs">
      <div className="space-y-6">
        <h1 className="sr-only">Runs</h1>
        <h2 className="sr-only">Run history</h2>
        <TimelineAndArtifacts />
      </div>
    </FixtureGatedPage>
  );
}
