import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { evaluateAuthAllowlist, readAuthAllowlistConfig } from "@/lib/auth/allowlist";
import { fetchGithubOrganizationLogins } from "@/lib/auth/github";
import { logger } from "@/lib/observability/logger";

const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : "loopworks-local-development-secret");

function readStringProperty(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID ?? "missing-github-client-id",
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? "missing-github-client-secret",
      authorization: {
        params: {
          scope: "read:user user:email read:org",
        },
      },
    }),
  ],
  callbacks: {
    authorized({ auth: session, request }) {
      const config = readAuthAllowlistConfig();
      const bypassSuppressed = request.headers.get("x-loopworks-disable-auth-bypass") === "true";
      return (config.bypass && !bypassSuppressed) || Boolean(session?.user);
    },
    async signIn({ account, profile }) {
      const config = readAuthAllowlistConfig();
      const githubLogin = readStringProperty(profile, "login");
      const githubOrganizations =
        config.allowedGithubOrgs.length > 0 && account?.access_token
          ? await fetchGithubOrganizationLogins({
              accessToken: account.access_token,
            })
          : [];

      const decision = evaluateAuthAllowlist(
        {
          githubLogin,
          githubOrganizations,
        },
        config,
      );

      logger.info(
        {
          githubLogin,
          reason: decision.reason,
          matchedValue: decision.allowed ? decision.matchedValue : undefined,
        },
        decision.allowed ? "auth_signin_allowed" : "auth_signin_denied",
      );

      return decision.allowed;
    },
    jwt({ token, profile }) {
      const githubLogin = readStringProperty(profile, "login");
      if (githubLogin) {
        token.githubLogin = githubLogin;
      }

      return token;
    },
    session({ session, token }) {
      session.user.githubLogin =
        typeof token.githubLogin === "string" && token.githubLogin.length > 0
          ? token.githubLogin
          : null;
      return session;
    },
  },
});
