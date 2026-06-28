import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import GitHub from "next-auth/providers/github";

import { db } from "@/db/client";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { readGithubAccessTokenForUser } from "@/lib/auth/accounts";
import { evaluateAuthAllowlist, readAuthAllowlistConfig } from "@/lib/auth/allowlist";
import { fetchGithubOrganizationLogins } from "@/lib/auth/github";
import {
  applyGithubLoginToSession,
  mapGithubProfileToAuthUser,
  readGithubLoginFromProfile,
} from "@/lib/auth/identity";
import { authorizeGithubSession } from "@/lib/auth/session-policy";
import { logger } from "@/lib/observability/logger";

const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : "loopworks-local-development-secret");

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  trustHost: true,
  secret: authSecret,
  session: {
    strategy: "database",
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
      profile: mapGithubProfileToAuthUser,
    }),
  ],
  callbacks: {
    async authorized({ auth: session, request }) {
      const config = readAuthAllowlistConfig();
      const bypassSuppressed = request.headers.get("x-loopworks-disable-auth-bypass") === "true";
      if (config.bypass && !bypassSuppressed) {
        return true;
      }

      const authorization = await authorizeGithubSession({
        session,
        config: {
          ...config,
          bypass: false,
        },
        readGithubAccessToken: readGithubAccessTokenForUser,
      });

      return authorization.authorized;
    },
    async signIn({ account, profile }) {
      const config = readAuthAllowlistConfig();
      const githubLogin = readGithubLoginFromProfile(profile);
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
    session({ session, user }) {
      return applyGithubLoginToSession(session, user);
    },
  },
});
