import { db } from "@/db/client";
import { createGithubInstallationGateway } from "@/lib/github/installation-gateway";
import { readGithubInstallationConfig } from "@/lib/github/installation-runtime";
import { createGithubRepositorySelectionFlow } from "@/lib/github/repository-selection";
import { createGithubRepositorySelectionStore } from "@/lib/github/repository-selection-store";

export function createGithubRepositorySelectionRuntime(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const config = readGithubInstallationConfig(env);
  return createGithubRepositorySelectionFlow({
    gateway: createGithubInstallationGateway({
      appId: config.appId,
      privateKey: config.privateKey,
    }),
    now: () => new Date(),
    store: createGithubRepositorySelectionStore(db, { appId: config.appId }),
  });
}
