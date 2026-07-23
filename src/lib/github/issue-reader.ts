import { App } from "@octokit/app";

export type GitHubIssueSnapshot = {
  labels: string[];
  state: "open" | "closed";
};

export type GitHubIssueReaderInput = {
  installationId: number;
  issueNumber: number;
  owner: string;
  repo: string;
};

export type GitHubIssueReader = {
  getIssue(input: GitHubIssueReaderInput): Promise<GitHubIssueSnapshot>;
};

type GitHubIssueReaderClient = {
  rest: {
    issues: {
      get(input: { issue_number: number; owner: string; repo: string }): Promise<{
        data: {
          labels: Array<string | { name?: string | null }>;
          state: string;
        };
      }>;
    };
  };
};

type GitHubIssueReaderDependencies = {
  getInstallationClient?: (installationId: number) => Promise<GitHubIssueReaderClient>;
};

function requiredEnvironmentValue(name: "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GitHub App configuration is missing ${name}.`);
  return value;
}

async function getDefaultInstallationClient(
  installationId: number,
): Promise<GitHubIssueReaderClient> {
  const app = new App({
    appId: requiredEnvironmentValue("GITHUB_APP_ID"),
    privateKey: requiredEnvironmentValue("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
  return (await app.getInstallationOctokit(installationId)) as unknown as GitHubIssueReaderClient;
}

function normalizeLabels(labels: Array<string | { name?: string | null }>): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .map((label) => label?.trim().toLowerCase())
    .filter((label): label is string => Boolean(label));
}

export function createGitHubIssueReader(
  dependencies: GitHubIssueReaderDependencies = {},
): GitHubIssueReader {
  const getInstallationClient = dependencies.getInstallationClient ?? getDefaultInstallationClient;

  return {
    async getIssue(input) {
      const client = await getInstallationClient(input.installationId);
      const response = await client.rest.issues.get({
        issue_number: input.issueNumber,
        owner: input.owner,
        repo: input.repo,
      });
      if (response.data.state !== "open" && response.data.state !== "closed") {
        throw new Error(`Unsupported GitHub issue state: ${response.data.state}`);
      }
      return {
        labels: normalizeLabels(response.data.labels),
        state: response.data.state,
      };
    },
  };
}
