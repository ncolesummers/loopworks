import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts } from "@/db/schema";

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
