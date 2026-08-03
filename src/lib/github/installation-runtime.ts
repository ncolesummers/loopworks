import { randomBytes } from "node:crypto";

import { db } from "@/db/client";
import { readStringConfig } from "@/lib/config/registry";
import { createGithubInstallationFlow } from "@/lib/github/installation-flow";
import { createGithubInstallationGateway } from "@/lib/github/installation-gateway";
import { createGithubInstallationStore } from "@/lib/github/installation-store";

export function readGithubInstallationConfig(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const rawAppId = readStringConfig("GITHUB_APP_ID", env);
  const appId = Number(rawAppId);
  const publicUrl = readStringConfig("LOOPWORKS_PUBLIC_URL", env);
  const clientId = readStringConfig("GITHUB_APP_CLIENT_ID", env);
  const clientSecret = readStringConfig("GITHUB_APP_CLIENT_SECRET", env);
  const privateKey = readStringConfig("GITHUB_APP_PRIVATE_KEY", env);
  const slug = readStringConfig("GITHUB_APP_SLUG", env);

  if (
    !Number.isSafeInteger(appId) ||
    appId <= 0 ||
    !publicUrl ||
    !clientId ||
    !clientSecret ||
    !privateKey ||
    !slug
  ) {
    throw new Error("github_installation_configuration_invalid");
  }

  return {
    appId,
    callbackUrl: new URL("/api/github/install/callback", publicUrl).toString(),
    clientId,
    clientSecret,
    privateKey,
    slug,
  };
}

export function createGithubInstallationRuntime(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const config = readGithubInstallationConfig(env);
  return createGithubInstallationFlow({
    config,
    gateway: createGithubInstallationGateway({
      appId: config.appId,
      privateKey: config.privateKey,
    }),
    generateSecret: () => randomBytes(32).toString("base64url"),
    now: () => new Date(),
    store: createGithubInstallationStore(db),
  });
}
