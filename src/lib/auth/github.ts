type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type FetchGithubOrganizationsOptions = {
  accessToken: string;
  fetchImpl?: FetchLike;
};

type GithubOrganization = {
  login?: unknown;
};

export type GithubOrganizationLookup =
  | { logins: string[]; status: "available" }
  | { status: "unavailable" };

export async function fetchGithubOrganizationLookup({
  accessToken,
  fetchImpl = fetch,
}: FetchGithubOrganizationsOptions): Promise<GithubOrganizationLookup> {
  if (!accessToken) {
    return { logins: [], status: "available" };
  }

  try {
    const response = await fetchImpl("https://api.github.com/user/orgs", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const organizations: unknown = await response.json();
    if (!Array.isArray(organizations)) {
      return { status: "unavailable" };
    }

    return {
      logins: organizations
        .filter(
          (organization): organization is GithubOrganization =>
            typeof organization === "object" && organization !== null,
        )
        .map((organization) => organization.login)
        .filter((login): login is string => typeof login === "string" && login.length > 0),
      status: "available",
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function fetchGithubOrganizationLogins(
  options: FetchGithubOrganizationsOptions,
): Promise<string[]> {
  const result = await fetchGithubOrganizationLookup(options);
  return result.status === "available" ? result.logins : [];
}
