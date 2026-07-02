import { LoopRegistry } from "@/components/portal/dashboard-view";
import { FixtureGatedPage } from "@/components/portal/fixture-gated-page";

export default function LoopsPage() {
  return (
    <FixtureGatedPage area="Loops">
      <div className="space-y-6">
        <h1 className="sr-only">Loops</h1>
        <h2 className="sr-only">Loop controls</h2>
        <LoopRegistry />
      </div>
    </FixtureGatedPage>
  );
}
