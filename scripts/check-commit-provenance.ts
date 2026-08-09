import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IANA_FIXTURE_DOMAINS = [
  "test",
  "example",
  "invalid",
  "localhost",
  "example.com",
  "example.net",
  "example.org",
] as const;

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const GRAPHQL_PAGE_SIZE = 100;
const MAX_GRAPHQL_PAGES = 1_000;

export type GithubActor = {
  login: string;
};

export type GithubCommitActor = {
  email: string | null;
  name: string | null;
  user: GithubActor | null;
} | null;

export type GithubCommitSignature = {
  isValid: boolean;
  signer: GithubActor | null;
  state: string | null;
  wasSignedByGitHub: boolean;
};

export type GithubCommitProvenance = {
  author: GithubCommitActor;
  committer: GithubCommitActor;
  message: string;
  oid: string;
  signature: GithubCommitSignature | null;
};

export type LocalCommitConfiguration = {
  authorIdent: string;
  commitGpgSign: string;
  committerIdent: string;
};

export type GitReadRunner = (
  args: string[],
  environment?: NodeJS.ProcessEnv,
) => string | Promise<string>;

export type PullRequestCommitsOptions = {
  pullRequestNumber: number;
  repository: string;
  token: string;
  fetchImplementation?: FetchImplementation;
};

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizedDomain(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@") || at === email.length - 1) return null;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
}

/** Return whether an address belongs to an IANA fixture/special-use domain. */
export function isReservedCommitEmail(email: string): boolean {
  const domain = normalizedDomain(email.trim());
  if (!domain) return false;

  return IANA_FIXTURE_DOMAINS.some(
    (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
  );
}

function isWellFormedCommitEmail(email: string): boolean {
  const at = email.indexOf("@");
  const localPart = email.slice(0, at);
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
    return false;
  }

  return /^[^\s@<>]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
    email,
  );
}

function parseGitIdentity(identity: string): { email: string } | null {
  const value = identity.trim();
  // `git var GIT_*_IDENT` emits: Name <email> unix-seconds +/-HHMM.
  const match = /^(?:.+?)\s+<([^<>\s]+@[^<>\s]+)>\s+-?\d+\s+[+-]\d{4}$/.exec(value);
  if (!match?.[1] || !isWellFormedCommitEmail(match[1])) return null;
  return { email: match[1] };
}

function signingEnabled(value: string): boolean {
  return new Set(["true", "yes", "on", "1"]).has(value.trim().toLowerCase());
}

/**
 * Validate the effective local identity and default signing configuration.
 * This function only validates supplied values; it never reads or mutates Git.
 */
export function validateLocalCommitConfiguration(
  configuration: LocalCommitConfiguration,
): string[] {
  const errors: string[] = [];

  const identities: Array<[label: string, value: string]> = [
    ["author", configuration.authorIdent],
    ["committer", configuration.committerIdent],
  ];

  for (const [label, value] of identities) {
    const parsed = parseGitIdentity(value);
    if (!parsed) {
      errors.push(
        `${label} identity is missing or malformed; Git must report Name <email> timestamp timezone.`,
      );
      continue;
    }
    if (isReservedCommitEmail(parsed.email)) {
      errors.push(
        `${label} email uses a reserved fixture domain; use a real contributor identity.`,
      );
    }
  }

  if (!signingEnabled(configuration.commitGpgSign)) {
    errors.push(
      "commit.gpgsign is missing or disabled; enable default signing before creating a commit.",
    );
  }

  return errors;
}

async function readGitValue(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: process.cwd(),
      env: environment,
      maxBuffer: 64 * 1024,
    });
    return result.stdout.trim();
  } catch {
    // A missing identity/config value is represented as empty input so the
    // deterministic validator can produce one bounded, actionable failure.
    return "";
  }
}

/** Read effective Git identity/signing values without changing Git config. */
export async function inspectLocalCommitConfiguration(
  runGit: GitReadRunner = readGitValue,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LocalCommitConfiguration> {
  const read = async (args: string[]): Promise<string> => {
    try {
      return (await runGit(args, environment)).trim();
    } catch {
      return "";
    }
  };

  const [authorIdent, committerIdent, commitGpgSign] = await Promise.all([
    read(["var", "GIT_AUTHOR_IDENT"]),
    read(["var", "GIT_COMMITTER_IDENT"]),
    read(["config", "--bool", "--get", "commit.gpgsign"]),
  ]);

  return { authorIdent, commitGpgSign, committerIdent };
}

function actorLogin(actor: GithubCommitActor): string | null {
  const login = actor?.user?.login;
  return typeof login === "string" && login.trim() ? login.trim() : null;
}

function signerLogin(signature: GithubCommitSignature): string | null {
  const login = signature.signer?.login;
  return typeof login === "string" && login.trim() ? login.trim() : null;
}

function commitLabel(commit: Partial<GithubCommitProvenance>): string {
  const oid = typeof commit.oid === "string" ? commit.oid.trim() : "";
  return oid ? `Commit ${oid.slice(0, 12)}:` : "Commit:";
}

function coAuthorEmails(message: string): string[] {
  const emails: string[] = [];
  for (const line of message.split(/\r?\n/)) {
    if (!/^\s*co-authored-by\s*:/i.test(line)) continue;
    const match = /<([^<>\s]+@[^<>\s]+)>/.exec(line);
    if (match?.[1]) emails.push(match[1]);
  }
  return emails;
}

function commitActorEmail(
  actor: GithubCommitActor,
  label: "author" | "committer",
  errors: string[],
  prefix: string,
): void {
  if (!actor || typeof actor.email !== "string" || !actor.email.trim()) {
    errors.push(`${prefix} ${label} email is missing.`);
    return;
  }
  if (isReservedCommitEmail(actor.email)) {
    errors.push(`${prefix} ${label} email uses a reserved fixture domain.`);
  }
}

/** Validate GitHub-resolved author, committer, signature, and co-author data. */
export function validateGithubCommit(commit: GithubCommitProvenance): string[] {
  const errors: string[] = [];
  const prefix = commitLabel(commit);

  commitActorEmail(commit.author, "author", errors, prefix);
  commitActorEmail(commit.committer, "committer", errors, prefix);

  if (!actorLogin(commit.author)) {
    errors.push(`${prefix} primary author has no resolved GitHub author.`);
  }

  if (typeof commit.message === "string") {
    for (const email of coAuthorEmails(commit.message)) {
      if (isReservedCommitEmail(email)) {
        errors.push(`${prefix} Co-authored-by email uses a reserved fixture domain.`);
      }
    }
  }

  const signature = commit.signature;
  if (!signature) {
    errors.push(`${prefix} commit is not signed.`);
    return errors;
  }

  if (signature.isValid !== true || signature.state?.toUpperCase() !== "VALID") {
    errors.push(`${prefix} signature is not valid according to GitHub.`);
  }

  const signer = signerLogin(signature);
  if (!signer) {
    errors.push(`${prefix} signature has no resolved GitHub signer.`);
    return errors;
  }

  if (!signature.wasSignedByGitHub) {
    const author = actorLogin(commit.author)?.toLowerCase();
    const committer = actorLogin(commit.committer)?.toLowerCase();
    const normalizedSigner = signer.toLowerCase();
    if (normalizedSigner !== author && normalizedSigner !== committer) {
      errors.push(`${prefix} signature signer must match the resolved author or committer.`);
    }
  }

  return errors;
}

const PULL_REQUEST_COMMITS_QUERY = `
  query PullRequestCommitProvenance(
    $cursor: String
    $name: String!
    $number: Int!
    $owner: String!
  ) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        commits(first: ${GRAPHQL_PAGE_SIZE}, after: $cursor) {
          nodes {
            commit {
              oid
              message
              author { name email user { login } }
              committer { name email user { login } }
              signature { isValid signer { login } state wasSignedByGitHub }
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }
`;

function parseRepository(repository: string): { name: string; owner: string } {
  const parts = repository.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("repository must use the OWNER/NAME format.");
  }
  return { name: parts[1], owner: parts[0] };
}

function genericGithubError(status?: number): Error {
  return new Error(
    status
      ? `GitHub commit provenance request failed (HTTP ${status}). Check token permissions and repository access.`
      : "GitHub commit provenance request failed. Check token permissions, repository access, and API availability.",
  );
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asCommit(value: unknown): GithubCommitProvenance {
  if (!isRecord(value)) throw genericGithubError();
  return value as unknown as GithubCommitProvenance;
}

async function fetchPullRequestCommitsWithOptions(
  options: PullRequestCommitsOptions,
): Promise<GithubCommitProvenance[]> {
  const { name, owner } = parseRepository(options.repository);
  const number = options.pullRequestNumber;
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("pull request number must be a positive integer.");
  }

  const token = options.token?.trim();
  if (!token) throw new Error("a GitHub token is required for commit provenance checks.");

  const request = options.fetchImplementation ?? globalThis.fetch;
  if (typeof request !== "function")
    throw new Error("Fetch is unavailable for GitHub commit provenance checks.");

  const commits: GithubCommitProvenance[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_GRAPHQL_PAGES; page += 1) {
    let response: Response;
    try {
      response = await request(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          query: PULL_REQUEST_COMMITS_QUERY,
          variables: { cursor, name, number, owner },
        }),
      });
    } catch {
      throw genericGithubError();
    }

    if (!response.ok) throw genericGithubError(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw genericGithubError();
    }

    if (!isRecord(body) || (Array.isArray(body.errors) && body.errors.length > 0)) {
      throw genericGithubError();
    }

    const repository = isRecord(body.data) ? body.data.repository : null;
    const pullRequest = isRecord(repository) ? repository.pullRequest : null;
    const commitConnection = isRecord(pullRequest) ? pullRequest.commits : null;
    const nodes = isRecord(commitConnection) ? commitConnection.nodes : null;
    const pageInfo = isRecord(commitConnection) ? commitConnection.pageInfo : null;

    if (!Array.isArray(nodes) || !isRecord(pageInfo)) throw genericGithubError();

    for (const node of nodes) {
      if (!isRecord(node) || !("commit" in node) || node.commit === null) {
        throw genericGithubError();
      }
      commits.push(asCommit(node.commit));
    }

    const hasNextPage = pageInfo.hasNextPage;
    if (hasNextPage !== true) return commits;

    const nextCursor = pageInfo.endCursor;
    if (!hasString(nextCursor) || cursors.has(nextCursor)) throw genericGithubError();
    cursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw genericGithubError();
}

export function fetchPullRequestCommits(
  options: PullRequestCommitsOptions,
): Promise<GithubCommitProvenance[]> {
  return fetchPullRequestCommitsWithOptions(options);
}

function printErrors(errors: string[]): void {
  for (const error of errors) console.error(`Commit provenance: ${error}`);
}

export async function runCommitProvenanceCli(
  argv: string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  if (argv.length === 1 && argv[0] === "--local") {
    const configuration = await inspectLocalCommitConfiguration();
    const errors = validateLocalCommitConfiguration(configuration);
    if (errors.length > 0) {
      printErrors(errors);
      return 1;
    }
    console.log("Commit provenance preflight passed.");
    return 0;
  }

  if (argv.length === 2 && argv[0] === "--github") {
    const pullRequestNumber = Number(argv[1]);
    const repository = environment.GITHUB_REPOSITORY;
    const token = environment.GH_TOKEN ?? environment.GITHUB_TOKEN;
    if (!repository) {
      printErrors(["GITHUB_REPOSITORY is required for a GitHub commit provenance check."]);
      return 1;
    }
    if (!token) {
      printErrors(["GH_TOKEN or GITHUB_TOKEN is required for a GitHub commit provenance check."]);
      return 1;
    }

    try {
      const commits = await fetchPullRequestCommits({
        pullRequestNumber,
        repository,
        token,
      });
      if (commits.length === 0) {
        printErrors(["pull request has no commits to verify."]);
        return 1;
      }
      const errors = commits.flatMap(validateGithubCommit);
      if (errors.length > 0) {
        printErrors(errors);
        return 1;
      }
      console.log(`GitHub commit provenance verified for ${commits.length} commit(s).`);
      return 0;
    } catch (error) {
      printErrors([
        error instanceof Error ? error.message : "unable to fetch GitHub commit provenance.",
      ]);
      return 1;
    }
  }

  printErrors(["usage: check-commit-provenance.ts --local | --github PULL_REQUEST_NUMBER"]);
  return 2;
}

if (import.meta.main) {
  runCommitProvenanceCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
