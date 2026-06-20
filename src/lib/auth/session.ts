import type { Session } from "next-auth";

import { readAuthAllowlistConfig } from "@/lib/auth/allowlist";

export type PortalSessionUser = {
  name: string;
  githubLogin: string;
  mode: "github" | "fixture";
};

export function getPortalSessionUser(session: Session | null): PortalSessionUser {
  if (session?.user) {
    const githubLogin = session.user.githubLogin ?? session.user.email ?? "github-user";
    return {
      name: session.user.name ?? githubLogin,
      githubLogin,
      mode: "github",
    };
  }

  const config = readAuthAllowlistConfig();
  const fixtureLogin = config.allowedGithubUsers[0] ?? "local-fixture";

  return {
    name: fixtureLogin,
    githubLogin: fixtureLogin,
    mode: "fixture",
  };
}
