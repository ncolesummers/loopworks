import type { Session } from "next-auth";

export type RepositorySelectionAuthorizationSubject = {
  authUserId: string;
  githubProviderAccountId: string;
};

function canonicalGithubProviderAccountId(value: unknown): string | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed.toString() === value ? value : null;
}

export function readRepositorySelectionAuthorizationSubject(
  session: Session | null,
): RepositorySelectionAuthorizationSubject | null {
  const authUserId = session?.user?.id?.trim();
  const githubProviderAccountId = canonicalGithubProviderAccountId(
    session?.user?.githubProviderAccountId,
  );
  return authUserId && githubProviderAccountId ? { authUserId, githubProviderAccountId } : null;
}
