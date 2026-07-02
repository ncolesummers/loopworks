import { DashboardView } from "@/components/portal/dashboard-view";
import { FixtureGatedPage } from "@/components/portal/fixture-gated-page";

export default function Page() {
  return (
    <FixtureGatedPage area="Dashboard">
      <DashboardView />
    </FixtureGatedPage>
  );
}
