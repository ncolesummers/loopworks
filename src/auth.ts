import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { db } from "@/db/client";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import {
  readGithubAccessTokenForUser,
  readGithubProviderAccountIdForUser,
} from "@/lib/auth/accounts";
import { readAuthAllowlistConfig } from "@/lib/auth/allowlist";
import { fetchGithubOrganizationLookup } from "@/lib/auth/github";
import {
  applyGithubIdentityToSession,
  getAuthUserId,
  mapGithubProfileToAuthUser,
  readGithubLoginFromProfile,
} from "@/lib/auth/identity";
import { authPages } from "@/lib/auth/pages";
import { authorizeGithubSession } from "@/lib/auth/session-policy";
import { resolveGithubSignInDecision } from "@/lib/auth/sign-in-decision";
import { readStringConfig } from "@/lib/config/registry";
import { logger } from "@/lib/observability/logger";

const authSecret = readStringConfig("AUTH_SECRET");

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  trustHost: true,
  secret: authSecret,
  // Both routes are app-owned so no operator ever reads a raw Auth.js error code. `error` must
  // alias `signIn`: see `src/lib/auth/pages.ts` for why an allowlist denial arrives there.
  pages: authPages,
  session: {
    strategy: "database",
  },
  providers: [
    GitHub({
      clientId: readStringConfig("AUTH_GITHUB_ID") ?? "missing-github-client-id",
      clientSecret: readStringConfig("AUTH_GITHUB_SECRET") ?? "missing-github-client-secret",
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
      let githubOrganizations: Awaited<ReturnType<typeof fetchGithubOrganizationLookup>> = {
        logins: [],
        status: "available",
      };
      if (config.allowedGithubOrgs.length > 0 && account?.access_token) {
        githubOrganizations = await fetchGithubOrganizationLookup({
          accessToken: account.access_token,
        });
      }

      const evaluation = resolveGithubSignInDecision({
        config,
        githubLogin,
        githubOrganizations,
      });

      if (evaluation.outcome === "unavailable") {
        logger.warn("auth_signin_github_org_lookup_unavailable");
        return evaluation.redirect;
      }

      const decision = evaluation.decision;

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
    async session({ session, user }) {
      const userId = getAuthUserId(user);
      const githubProviderAccountId = userId
        ? await readGithubProviderAccountIdForUser(userId)
        : null;
      return applyGithubIdentityToSession(session, user, githubProviderAccountId);
    },
  },
});
