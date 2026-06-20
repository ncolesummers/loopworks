import { auth } from "@/auth";
import { PortalShell } from "@/components/portal/portal-shell";
import { DashboardView } from "@/components/portal/dashboard-view";
import { getPortalSessionUser } from "@/lib/auth/session";

export default async function Page() {
  const session = await auth();

  return (
    <PortalShell user={getPortalSessionUser(session)}>
      <DashboardView />
    </PortalShell>
  );
}
