import { FixtureGatedPage } from "@/components/portal/fixture-gated-page";
import { GitHubSettingsView } from "@/components/portal/github-settings-view";

export default function SettingsPage() {
  return (
    <FixtureGatedPage area="Settings">
      <GitHubSettingsView />
    </FixtureGatedPage>
  );
}
