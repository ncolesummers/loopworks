import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

import type {
  AvailableGithubRepository,
  GithubInstallationGateway,
  VerifiedGithubInstallation,
} from "@/lib/github/installation-flow";

type AppClient = {
  request(route: string, parameters: Record<string, unknown>): Promise<{ data: unknown }>;
};

type InstallationClient = {
  paginate(route: string, parameters: Record<string, unknown>): Promise<unknown[]>;
};

type UserClient = {
  paginate(route: string, parameters: Record<string, unknown>): Promise<unknown[]>;
  request(route: string): Promise<{ data: unknown }>;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeInstallation(value: unknown): VerifiedGithubInstallation {
  const data = object(value);
  const account = object(data?.account);
  const installationId = positiveInteger(data?.id);
  const appId = positiveInteger(data?.app_id);
  const accountId = positiveInteger(account?.id);
  const accountLogin =
    typeof account?.login === "string"
      ? account.login
      : typeof account?.slug === "string"
        ? account.slug
        : null;
  const accountType =
    typeof account?.type === "string"
      ? account.type
      : typeof data?.target_type === "string"
        ? data.target_type
        : null;
  const repositorySelection = data?.repository_selection;
  const suspendedAt = data?.suspended_at;

  if (
    !installationId ||
    !appId ||
    !accountId ||
    !accountLogin ||
    !accountType ||
    (repositorySelection !== "all" && repositorySelection !== "selected") ||
    (suspendedAt !== undefined && suspendedAt !== null && typeof suspendedAt !== "string") ||
    suspendedAt
  ) {
    throw new Error("github_installation_verification_failed");
  }

  return {
    accountId,
    accountLogin,
    accountType,
    appId,
    installationId,
    repositorySelection,
    suspendedAt: null,
  };
}

function normalizeRepository(value: unknown): AvailableGithubRepository {
  const data = object(value);
  const owner = object(data?.owner);
  const githubRepoId = positiveInteger(data?.id);
  const name = typeof data?.name === "string" ? data.name : null;
  const fullName = typeof data?.full_name === "string" ? data.full_name : null;
  const ownerLogin = typeof owner?.login === "string" ? owner.login : null;
  const defaultBranch = typeof data?.default_branch === "string" ? data.default_branch : null;

  if (!githubRepoId || !name || !fullName || !ownerLogin || !defaultBranch) {
    throw new Error("github_repository_verification_failed");
  }

  return {
    archived: data?.archived === true,
    defaultBranch,
    fullName,
    githubRepoId,
    name,
    owner: ownerLogin,
    private: data?.private === true,
  };
}

export function createGithubInstallationGateway(input: {
  appId: number;
  createAppClient?: () => AppClient;
  createInstallationClient?: (installationId: number) => Promise<InstallationClient>;
  createUserClient?: (accessToken: string) => UserClient;
  /** Only the OAuth code exchange. The Octokit clients below do not route through this. */
  oauthFetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  privateKey: string;
}): GithubInstallationGateway {
  const oauthFetchImpl = input.oauthFetchImpl ?? fetch;
  let appInstance: App | null = null;
  // Constructing `App` is not free and each mint re-signs an RSA JWT; build it once per gateway.
  const app = () => {
    appInstance ??= new App({
      appId: input.appId,
      privateKey: input.privateKey.replaceAll("\\n", "\n"),
    });
    return appInstance;
  };
  // None of these three are annotated on purpose. The annotation is what #152 effectively had:
  // it asserts the default satisfies the contract instead of checking it, so a client missing a
  // method compiles clean and fails in production. Leaving them inferred makes each call site
  // compare the real SDK shape against the structural type. Do not add a type annotation here.
  const createAppClient = input.createAppClient ?? (() => app().octokit);
  // `App.getInstallationOctokit` returns an `@octokit/core` instance, which has no `paginate`.
  // Mint the installation token and wrap it in `@octokit/rest`, which bundles the paginate plugin.
  // `getInstallationOctokit` cached its token internally; cache per installation so replacing it
  // does not multiply mints against the per-installation rate limit. Tokens live an hour and a
  // gateway is built per request, so no expiry handling is needed at this lifetime.
  const installationClients = new Map<number, Promise<InstallationClient>>();
  const mintInstallationClient = async (installationId: number) => {
    const response = await app().octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      { installation_id: installationId },
    );
    const token = object(response.data)?.token;
    // An absent or renamed token would silently build an unauthenticated client, which fails
    // later as an opaque 401 against a different endpoint.
    if (typeof token !== "string" || !token) throw new Error("github_installation_token_failed");
    return new Octokit({ auth: token });
  };
  const createInstallationClient =
    input.createInstallationClient ??
    ((installationId: number) => {
      let client = installationClients.get(installationId);
      if (!client) {
        client = mintInstallationClient(installationId);
        // A rejected mint must not be cached, or one transient failure poisons the gateway.
        client.catch(() => installationClients.delete(installationId));
        installationClients.set(installationId, client);
      }
      return client;
    });
  const createUserClient =
    input.createUserClient ?? ((accessToken: string) => new Octokit({ auth: accessToken }));

  // One pagination call site for both installation reads, as a standalone
  // function rather than a `this` call so a destructured gateway method keeps
  // working.
  const paginateUserInstallations = (accessToken: string) =>
    createUserClient(accessToken).paginate("GET /user/installations", { per_page: 100 });

  return {
    async exchangeUserCode(exchangeInput) {
      const body = new URLSearchParams({
        client_id: exchangeInput.clientId,
        client_secret: exchangeInput.clientSecret,
        code: exchangeInput.code,
        code_verifier: exchangeInput.codeVerifier,
        redirect_uri: exchangeInput.redirectUri,
      });
      const response = await oauthFetchImpl("https://github.com/login/oauth/access_token", {
        method: "POST",
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      let payload: Record<string, unknown> | null = null;
      try {
        payload = object(await response.json());
      } catch {
        throw new Error("github_oauth_exchange_failed");
      }
      if (!response.ok || typeof payload?.access_token !== "string" || payload.error) {
        throw new Error("github_oauth_exchange_failed");
      }
      return payload.access_token;
    },

    async listInstallationRepositories(installationId) {
      const client = await createInstallationClient(installationId);
      const repositories = await client.paginate("GET /installation/repositories", {
        per_page: 100,
      });
      return repositories.map(normalizeRepository);
    },

    async getAuthenticatedUserLogin(accessToken) {
      const response = await createUserClient(accessToken).request("GET /user");
      const data = object(response.data);
      if (typeof data?.login !== "string") throw new Error("github_user_verification_failed");
      return data.login;
    },

    async listUserInstallations(accessToken) {
      const installations = await paginateUserInstallations(accessToken);
      return installations.flatMap((installation) => {
        const data = object(installation);
        const installationId = positiveInteger(data?.id);
        const appId = positiveInteger(data?.app_id);
        // Reconciliation matches candidates against the configured app id, so an
        // entry missing either identifier cannot be matched and is dropped.
        return installationId && appId ? [{ appId, installationId }] : [];
      });
    },

    async userCanAccessInstallation(accessToken, installationId) {
      const installations = await paginateUserInstallations(accessToken);
      return installations.some((installation) => object(installation)?.id === installationId);
    },

    async verifyAppInstallation(installationId) {
      const response = await createAppClient().request("GET /app/installations/{installation_id}", {
        installation_id: installationId,
      });
      return normalizeInstallation(response.data);
    },
  };
}
