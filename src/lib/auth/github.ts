type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type FetchGithubOrganizationsOptions = {
  accessToken: string;
  fetchImpl?: FetchLike;
};

type GithubOrganization = {
  login?: unknown;
};

export async function fetchGithubOrganizationLogins({
  accessToken,
  fetchImpl = fetch,
}: FetchGithubOrganizationsOptions): Promise<string[]> {
  if (!accessToken) {
    return [];
  }

  const response = await fetchImpl("https://api.github.com/user/orgs", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    return [];
  }

  const organizations = (await response.json()) as GithubOrganization[];
  return organizations
    .map((organization) => organization.login)
    .filter((login): login is string => typeof login === "string" && login.length > 0);
}
