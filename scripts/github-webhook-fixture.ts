#!/usr/bin/env bun

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { readStringConfig } from "@/lib/config/registry";

export type GithubWebhookFixtureKind =
  | "agent-ready"
  | "milestone-agent-ready"
  | "spike-agent-ready";

type GithubWebhookFixtureOptions = {
  actor?: { id: number; login: string };
  deliveryId: string;
  installationId?: number;
  kind: GithubWebhookFixtureKind;
  repository?: { fullName: string; id: number };
  secret: string;
  url: string;
};

type GithubWebhookFixtureIdentity = {
  actor: { id: number; login: string };
  installationId: number;
  repository: { fullName: string; id: number };
};

type GithubWebhookFixturePayload = {
  action: "labeled" | "milestoned";
  installation: { id: number };
  issue: {
    body: string;
    html_url: string;
    labels: { name: string }[];
    milestone: { id: number; title: string };
    number: number;
    state: "open";
    title: string;
  };
  repository: {
    full_name: string;
    id: number;
  };
  sender: { id: number; login: string };
  label?: { name: string };
  milestone?: { id: number; title: string };
};

export type GithubWebhookFixture = {
  deliveryId: string;
  headers: Record<string, string>;
  kind: GithubWebhookFixtureKind;
  payload: GithubWebhookFixturePayload;
  payloadText: string;
  signature: string;
  url: string;
};

const defaultUrl = "http://127.0.0.1:3000/api/github/webhooks";
const defaultRepository = "ncolesummers/loopworks";
const defaultFixtureIdentity: GithubWebhookFixtureIdentity = {
  actor: { id: 22_808_397, login: "ncolesummers" },
  installationId: 124_001,
  repository: { fullName: defaultRepository, id: 11_000_001 },
};
const validKinds = new Set<GithubWebhookFixtureKind>([
  "agent-ready",
  "milestone-agent-ready",
  "spike-agent-ready",
]);

function isGithubWebhookFixtureKind(value: string): value is GithubWebhookFixtureKind {
  return validKinds.has(value as GithubWebhookFixtureKind);
}

function createSignature(secret: string, payloadText: string): string {
  return `sha256=${createHmac("sha256", secret).update(payloadText).digest("hex")}`;
}

function createPayload(
  kind: GithubWebhookFixtureKind,
  identity: GithubWebhookFixtureIdentity,
): GithubWebhookFixturePayload {
  const isResearch = kind === "spike-agent-ready";
  const isMilestone = kind === "milestone-agent-ready";
  const labels = isResearch
    ? ["agent-ready", "spike", "area:loops", "area:agents", "loop:research", "priority:p2"]
    : ["agent-ready", "area:loops", "area:agents", "loop:development", "priority:p0"];

  const milestone = { id: 31, title: "M3 Durable Loop MVP" };
  return {
    action: isMilestone ? "milestoned" : "labeled",
    installation: { id: identity.installationId },
    issue: {
      body: isResearch
        ? "Implement a durable, fixture-backed research loop skeleton."
        : "Implement the first durable loop skeleton for issues labeled agent-ready.",
      html_url: `https://github.com/ncolesummers/loopworks/issues/${isResearch ? 43 : 11}`,
      labels: labels.map((name) => ({ name })),
      milestone,
      number: isResearch ? 43 : 11,
      state: "open",
      title: isResearch ? "Research loop skeleton" : "Agent-ready development loop skeleton",
    },
    repository: {
      full_name: identity.repository.fullName,
      id: identity.repository.id,
    },
    sender: identity.actor,
    ...(isMilestone ? { milestone } : { label: { name: "agent-ready" } }),
  };
}

export function createGithubWebhookFixture(
  options: GithubWebhookFixtureOptions,
): GithubWebhookFixture {
  if (!isGithubWebhookFixtureKind(options.kind)) {
    throw new Error(
      "Fixture kind must be agent-ready, milestone-agent-ready, or spike-agent-ready.",
    );
  }

  const deliveryId = options.deliveryId.trim();
  if (!deliveryId) {
    throw new Error("A non-empty delivery id is required.");
  }

  const secret = options.secret.trim();
  if (!secret) {
    throw new Error("GITHUB_WEBHOOK_SECRET is required to sign the fixture.");
  }

  const identity = {
    actor: options.actor ?? defaultFixtureIdentity.actor,
    installationId: options.installationId ?? defaultFixtureIdentity.installationId,
    repository: options.repository ?? defaultFixtureIdentity.repository,
  };
  if (
    !Number.isSafeInteger(identity.actor.id) ||
    identity.actor.id <= 0 ||
    !identity.actor.login.trim() ||
    !Number.isSafeInteger(identity.installationId) ||
    identity.installationId <= 0 ||
    !Number.isSafeInteger(identity.repository.id) ||
    identity.repository.id <= 0 ||
    !/^[^/\s]+\/[^/\s]+$/.test(identity.repository.fullName)
  ) {
    throw new Error(
      "Fixture identity must contain positive immutable IDs and an owner/repository name.",
    );
  }

  const payload = createPayload(options.kind, identity);
  const payloadText = JSON.stringify(payload);
  const signature = createSignature(secret, payloadText);

  return {
    deliveryId,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": "issues",
      "x-hub-signature-256": signature,
    },
    kind: options.kind,
    payload,
    payloadText,
    signature,
    url: options.url,
  };
}

type ParsedArgs = {
  actor: { id: number; login: string };
  deliveryId: string;
  explicitIdentity: boolean;
  installationId: number;
  kind: GithubWebhookFixtureKind;
  repository: { fullName: string; id: number };
  send: boolean;
  url: string;
};

function usage(): string {
  return [
    "Usage: bun run github:webhook-fixture [--kind agent-ready|milestone-agent-ready|spike-agent-ready] [--delivery-id id] [--url url] [--dry-run|--send]",
    "       [--repository owner/repo --repository-id id --installation-id id --sender-id id --sender-login login]",
    "",
    "Defaults to --dry-run. Requires GITHUB_WEBHOOK_SECRET. --send only allows loopback URLs and requires the exact active tracked identity tuple.",
  ].join("\n");
}

function readPositiveInteger(args: string[], index: number, flag: string): number {
  const raw = readValue(args, index, flag);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function parseGithubWebhookFixtureArgs(args: string[]): ParsedArgs {
  let deliveryId = `local-${new Date().toISOString().replaceAll(":", "-")}`;
  let kind: GithubWebhookFixtureKind = "agent-ready";
  const explicitIdentityFlags = new Set<string>();
  let actor = { ...defaultFixtureIdentity.actor };
  let installationId = defaultFixtureIdentity.installationId;
  let repository = { ...defaultFixtureIdentity.repository };
  let send = false;
  let sawDryRun = false;
  let url = defaultUrl;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--delivery-id":
        deliveryId = readValue(args, index, arg);
        index += 1;
        break;
      case "--dry-run":
        sawDryRun = true;
        break;
      case "--installation-id":
        installationId = readPositiveInteger(args, index, arg);
        explicitIdentityFlags.add(arg);
        index += 1;
        break;
      case "--kind": {
        const value = readValue(args, index, arg);
        if (!isGithubWebhookFixtureKind(value)) {
          throw new Error(
            "--kind must be agent-ready, milestone-agent-ready, or spike-agent-ready.",
          );
        }
        kind = value;
        index += 1;
        break;
      }
      case "--send":
        send = true;
        break;
      case "--repository":
        repository = { ...repository, fullName: readValue(args, index, arg) };
        explicitIdentityFlags.add(arg);
        index += 1;
        break;
      case "--repository-id":
        repository = { ...repository, id: readPositiveInteger(args, index, arg) };
        explicitIdentityFlags.add(arg);
        index += 1;
        break;
      case "--sender-id":
        actor = { ...actor, id: readPositiveInteger(args, index, arg) };
        explicitIdentityFlags.add(arg);
        index += 1;
        break;
      case "--sender-login":
        actor = { ...actor, login: readValue(args, index, arg) };
        explicitIdentityFlags.add(arg);
        index += 1;
        break;
      case "--url":
        url = readValue(args, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (send && sawDryRun) {
    throw new Error("Use either --dry-run or --send, not both.");
  }

  return {
    actor,
    deliveryId,
    explicitIdentity:
      explicitIdentityFlags.size === 5 &&
      [
        "--installation-id",
        "--repository",
        "--repository-id",
        "--sender-id",
        "--sender-login",
      ].every((flag) => explicitIdentityFlags.has(flag)),
    installationId,
    kind,
    repository,
    send,
    url,
  };
}

function isLoopbackWebhookUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  return (
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]" ||
    (isIP(parsed.hostname) === 4 && parsed.hostname.split(".")[0] === "127")
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatWebhookUrlForLog(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.password = "";
    parsed.username = "";
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

function printFixtureDryRun(fixture: GithubWebhookFixture) {
  console.log("LoopWorks GitHub webhook fixture dry run");
  console.log(`Kind: ${fixture.kind}`);
  console.log(`URL: ${formatWebhookUrlForLog(fixture.url)}`);
  console.log("Headers:");
  console.log(`x-github-delivery: ${fixture.headers["x-github-delivery"]}`);
  console.log(`x-github-event: ${fixture.headers["x-github-event"]}`);
  console.log(`x-hub-signature-256: ${fixture.signature}`);
  console.log("Payload:");
  console.log(`Action: ${fixture.payload.action}`);
  console.log(
    `Repository: ${fixture.payload.repository.full_name} (${fixture.payload.repository.id})`,
  );
  console.log(`Installation: ${fixture.payload.installation.id}`);
  console.log(`Sender: ${fixture.payload.sender.login} (${fixture.payload.sender.id})`);
  if (fixture.payload.label) console.log(`Changed label: ${fixture.payload.label.name}`);
  if (fixture.payload.milestone) {
    console.log(
      `Changed milestone: ${fixture.payload.milestone.title} (${fixture.payload.milestone.id})`,
    );
  }
  console.log(`Issue: #${fixture.payload.issue.number} ${fixture.payload.issue.title}`);
  console.log(`Labels: ${fixture.payload.issue.labels.map((label) => label.name).join(", ")}`);
  console.log("Add --send to POST this signed fixture.");
}

export async function runGithubWebhookFixtureCli(args: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseGithubWebhookFixtureArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 1;
  }

  let fixture: GithubWebhookFixture;
  try {
    fixture = createGithubWebhookFixture({
      actor: parsed.actor,
      deliveryId: parsed.deliveryId,
      installationId: parsed.installationId,
      kind: parsed.kind,
      repository: parsed.repository,
      secret: readStringConfig("GITHUB_WEBHOOK_SECRET") ?? "",
      url: parsed.url,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (!parsed.send) {
    printFixtureDryRun(fixture);
    return 0;
  }

  if (!isLoopbackWebhookUrl(fixture.url)) {
    console.error(
      `Refusing to send signed webhook fixtures to non-loopback URL: ${formatWebhookUrlForLog(fixture.url)}`,
    );
    return 1;
  }

  if (!parsed.explicitIdentity) {
    console.error(
      "--send requires the exact active tracked repository, repository ID, installation ID, sender ID, and sender login.",
    );
    return 1;
  }

  let response: Response;
  try {
    response = await fetch(fixture.url, {
      body: fixture.payloadText,
      headers: fixture.headers,
      method: "POST",
    });
  } catch (error) {
    console.error(
      `Failed to reach ${formatWebhookUrlForLog(fixture.url)}: ${getErrorMessage(error)}. Is the dev server running (bun run dev)?`,
    );
    return 1;
  }

  console.log(`GitHub webhook fixture response: ${response.status}`);

  return response.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await runGithubWebhookFixtureCli(process.argv.slice(2));
}
