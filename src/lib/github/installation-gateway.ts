import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

import type {
  GithubInstallationGateway,
  VerifiedGithubInstallation,
} from "@/lib/github/installation-flow";

type AppClient = {
  request(route: string, parameters: Record<string, unknown>): Promise<{ data: unknown }>;
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

export function createGithubInstallationGateway(input: {
  appId: number;
  createAppClient?: () => AppClient;
  createUserClient?: (accessToken: string) => UserClient;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  privateKey: string;
}): GithubInstallationGateway {
  const fetchImpl = input.fetchImpl ?? fetch;
  const createAppClient =
    input.createAppClient ??
    (() =>
      new App({
        appId: input.appId,
        privateKey: input.privateKey.replaceAll("\\n", "\n"),
      }).octokit as unknown as AppClient);
  const createUserClient =
    input.createUserClient ??
    ((accessToken: string) => new Octokit({ auth: accessToken }) as unknown as UserClient);

  return {
    async exchangeUserCode(exchangeInput) {
      const body = new URLSearchParams({
        client_id: exchangeInput.clientId,
        client_secret: exchangeInput.clientSecret,
        code: exchangeInput.code,
        code_verifier: exchangeInput.codeVerifier,
        redirect_uri: exchangeInput.redirectUri,
      });
      const response = await fetchImpl("https://github.com/login/oauth/access_token", {
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

    async getAuthenticatedUserLogin(accessToken) {
      const response = await createUserClient(accessToken).request("GET /user");
      const data = object(response.data);
      if (typeof data?.login !== "string") throw new Error("github_user_verification_failed");
      return data.login;
    },

    async userCanAccessInstallation(accessToken, installationId) {
      const installations = await createUserClient(accessToken).paginate(
        "GET /user/installations",
        {
          per_page: 100,
        },
      );
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
