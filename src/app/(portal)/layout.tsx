import type { ReactNode } from "react";

import { auth } from "@/auth";
import { PortalShell } from "@/components/portal/portal-shell";
import { getPortalSessionUser } from "@/lib/auth/session";

export default async function PortalLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await auth();

  return <PortalShell user={getPortalSessionUser(session)}>{children}</PortalShell>;
}
