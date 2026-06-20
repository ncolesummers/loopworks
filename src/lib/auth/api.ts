import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { readAuthAllowlistConfig } from "@/lib/auth/allowlist";
import type { LoopworksLogger } from "@/lib/observability/logger";

export type ApiSession =
  | {
      authenticated: true;
      actorId: string;
      mode: "github" | "fixture";
      session: Session | null;
    }
  | {
      authenticated: false;
      response: NextResponse;
    };

function actorIdFromSession(session: Session): string {
  return session.user.githubLogin ?? session.user.email ?? session.user.name ?? "github-user";
}

export async function requireApiSession(input: {
  route: string;
  logger?: LoopworksLogger;
}): Promise<ApiSession> {
  const session = await auth();

  if (session?.user) {
    return {
      authenticated: true,
      actorId: actorIdFromSession(session),
      mode: "github",
      session,
    };
  }

  const config = readAuthAllowlistConfig();
  if (config.bypass) {
    return {
      authenticated: true,
      actorId: config.allowedGithubUsers[0] ?? "local-fixture",
      mode: "fixture",
      session: null,
    };
  }

  input.logger?.warn(
    {
      route: input.route,
    },
    "api_auth_required",
  );

  return {
    authenticated: false,
    response: NextResponse.json(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    ),
  };
}
