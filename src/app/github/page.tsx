import { auth } from "@/auth";
import { PortalShell } from "@/components/portal/portal-shell";
import { GitHubSettingsView } from "@/components/portal/github-settings-view";
import { getPortalSessionUser } from "@/lib/auth/session";

export default async function GitHubPage() {
  const session = await auth();

  return (
    <PortalShell user={getPortalSessionUser(session)}>
      <GitHubSettingsView />
    </PortalShell>
  );
}
