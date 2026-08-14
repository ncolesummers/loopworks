import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts } from "@/db/schema";

export type AuthAccountDatabase = Pick<typeof db, "select">;

function canonicalGithubProviderAccountId(value: string): string | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed.toString() === value ? value : null;
}

export function createAuthAccountReader(database: AuthAccountDatabase) {
  return {
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
