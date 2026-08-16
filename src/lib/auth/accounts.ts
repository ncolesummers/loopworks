import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import type { RepositorySelectionAuthorizationSubject } from "@/lib/auth/repository-selection-subject";

export type AuthAccountDatabase = Pick<typeof db, "select" | "update">;

function canonicalGithubProviderAccountId(value: string): string | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed.toString() === value ? value : null;
}

export function createAuthAccountReader(database: AuthAccountDatabase) {
  return {
    async refreshGithubAccessTokenForAccount(input: {
      accessToken: string;
      providerAccountId: string;
    }): Promise<void> {
      const providerAccountId = canonicalGithubProviderAccountId(input.providerAccountId);
      if (
        !providerAccountId ||
        !input.accessToken ||
        input.accessToken.trim() !== input.accessToken
      ) {
        return;
      }

      await database
        .update(accounts)
        .set({ access_token: input.accessToken })
        .where(
          and(eq(accounts.provider, "github"), eq(accounts.providerAccountId, providerAccountId)),
        );
    },

    async readGithubAccessEvidenceForSubject(
      subject: RepositorySelectionAuthorizationSubject,
    ): Promise<{ accessToken: string } | null> {
      const normalizedUserId = subject.authUserId.trim();
      const providerAccountId = canonicalGithubProviderAccountId(subject.githubProviderAccountId);
      if (!normalizedUserId || !providerAccountId) return null;

      const matchingAccounts = await database
        .select({
          accessToken: accounts.access_token,
          providerAccountId: accounts.providerAccountId,
        })
        .from(accounts)
        .where(and(eq(accounts.userId, normalizedUserId), eq(accounts.provider, "github")))
        .limit(2);
      if (matchingAccounts.length !== 1) return null;

      const account = matchingAccounts[0];
      const canonicalAccountId = canonicalGithubProviderAccountId(account?.providerAccountId ?? "");
      const accessToken = account?.accessToken;
      return canonicalAccountId === providerAccountId &&
        accessToken &&
        accessToken.trim() === accessToken
        ? { accessToken }
        : null;
    },

    async readGithubProviderAccountIdForUser(userId: string): Promise<string | null> {
      const normalizedUserId = userId.trim();
      if (!normalizedUserId) return null;

      const matchingAccounts = await database
        .select({ providerAccountId: accounts.providerAccountId })
        .from(accounts)
        .where(and(eq(accounts.userId, normalizedUserId), eq(accounts.provider, "github")))
        .limit(2);
      if (matchingAccounts.length !== 1) return null;

      return canonicalGithubProviderAccountId(matchingAccounts[0]?.providerAccountId ?? "");
    },
  };
}

const authAccountReader = createAuthAccountReader(db);

export const readGithubProviderAccountIdForUser =
  authAccountReader.readGithubProviderAccountIdForUser;

export const readGithubAccessEvidenceForSubject =
  authAccountReader.readGithubAccessEvidenceForSubject;

export const refreshGithubAccessTokenForAccount =
  authAccountReader.refreshGithubAccessTokenForAccount;

export async function readGithubAccessTokenForUser(userId: string): Promise<string | null> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return null;
  }

  const [account] = await db
    .select({
      accessToken: accounts.access_token,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, normalizedUserId), eq(accounts.provider, "github")))
    .limit(1);

  return account?.accessToken ?? null;
}
