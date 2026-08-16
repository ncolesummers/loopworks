import { db } from "@/db/client";
import { createAuthAccountReader } from "@/lib/auth/accounts";
import { readStringConfig } from "@/lib/config/registry";
import { createGithubInstallationGateway } from "@/lib/github/installation-gateway";
import { readGithubInstallationConfig } from "@/lib/github/installation-runtime";
import { createGithubRepositorySelectionFlow } from "@/lib/github/repository-selection";
import {
  createRepositorySelectionAuthorizationCache,
  createRepositorySelectionAuthorizer,
  repositorySelectionAuthorizationMonotonicNow,
} from "@/lib/github/repository-selection-authorization";
import { createGithubRepositorySelectionStore } from "@/lib/github/repository-selection-store";

const repositorySelectionAuthorizationCache = createRepositorySelectionAuthorizationCache({
  now: repositorySelectionAuthorizationMonotonicNow,
  ttlMs: 60_000,
});

export function createGithubRepositorySelectionRuntime(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const config = readGithubInstallationConfig(env);
  const gateway = createGithubInstallationGateway({
    appId: config.appId,
    privateKey: config.privateKey,
  });
  const accountReader = createAuthAccountReader(db);
  const authorizer = createRepositorySelectionAuthorizer({
    appId: config.appId,
    authGithubClientId: readStringConfig("AUTH_GITHUB_ID", env),
    cache: repositorySelectionAuthorizationCache,
    githubAppClientId: config.clientId,
    readAccessEvidence: accountReader.readGithubAccessEvidenceForSubject,
    userCanAccessInstallation: gateway.userCanAccessInstallation,
  });
  return createGithubRepositorySelectionFlow({
    authorizeInstallationAccess: authorizer.authorize,
    gateway,
    now: () => new Date(),
    store: createGithubRepositorySelectionStore(db, { appId: config.appId }),
  });
}
