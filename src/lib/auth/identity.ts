import type { Session, User } from "next-auth";

type UnknownRecord = Record<string, unknown>;

export type AuthUserWithGithubLogin = Pick<User, "email" | "id" | "image" | "name"> & {
  githubLogin?: string | null;
};

function readRecord(source: unknown): UnknownRecord | null {
  return source && typeof source === "object" ? (source as UnknownRecord) : null;
}

function readStringProperty(source: unknown, key: string): string | null {
  const record = readRecord(source);
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readIdProperty(source: unknown): string {
  const record = readRecord(source);
  const value = record?.id;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  return "missing-github-id";
}

export function readGithubLoginFromProfile(profile: unknown): string | null {
  return readStringProperty(profile, "login");
}

export function mapGithubProfileToAuthUser(profile: unknown): User {
  const githubLogin = readGithubLoginFromProfile(profile);

  return {
    id: readIdProperty(profile),
    name: readStringProperty(profile, "name") ?? githubLogin,
    email: readStringProperty(profile, "email"),
    image: readStringProperty(profile, "avatar_url"),
    githubLogin,
  };
}

export function getGithubLoginFromAuthUser(user: AuthUserWithGithubLogin | null): string | null {
  return typeof user?.githubLogin === "string" && user.githubLogin.length > 0
    ? user.githubLogin
    : null;
}

export function getAuthUserId(user: AuthUserWithGithubLogin | null): string | null {
  return typeof user?.id === "string" && user.id.length > 0 ? user.id : null;
}

export function applyGithubLoginToSession(
  session: Session,
  user: AuthUserWithGithubLogin | null,
): Session {
  session.user = {
    ...session.user,
    id: getAuthUserId(user) ?? session.user.id,
    githubLogin: getGithubLoginFromAuthUser(user),
  };

  return session;
}
