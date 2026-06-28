import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { readGithubAccessTokenForUser } from "@/lib/auth/accounts";
import { readAuthAllowlistConfig } from "@/lib/auth/allowlist";
import { getGithubLoginFromAuthUser } from "@/lib/auth/identity";
import { authorizeGithubSession } from "@/lib/auth/session-policy";
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
  const githubLogin = getGithubLoginFromAuthUser(session.user);
  if (!githubLogin) {
    throw new Error("Authenticated GitHub API sessions require a persisted githubLogin.");
  }

  return githubLogin;
}

export async function requireApiSession(input: {
  route: string;
  logger?: LoopworksLogger;
}): Promise<ApiSession> {
  const session = await auth();
  const config = readAuthAllowlistConfig();

  if (session?.user) {
    const authorization = await authorizeGithubSession({
      session,
      config: {
        ...config,
        bypass: false,
      },
      readGithubAccessToken: readGithubAccessTokenForUser,
    });
    if (!authorization.authorized) {
      input.logger?.warn(
        {
          route: input.route,
          githubLogin: authorization.githubLogin,
          reason: authorization.reason,
        },
        "api_auth_denied",
      );

      return {
        authenticated: false,
        response: NextResponse.json(
          {
            error: "GitHub identity is not authorized.",
            reason: authorization.reason,
          },
          { status: 403 },
        ),
      };
    }

    return {
      authenticated: true,
      actorId: actorIdFromSession(session),
      mode: "github",
      session,
    };
  }

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
