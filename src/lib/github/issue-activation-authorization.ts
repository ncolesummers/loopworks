import { App } from "@octokit/app";
import { readStringConfig } from "@/lib/config/registry";
import { defaultGithubAgentReadyRules, evaluateGithubIssueReadiness } from "@/lib/github/webhooks";
import type { LoopDefinition } from "../../../schemas/loop-manifest";

export type GithubIssueActivationActor = {
  id: number;
  login: string;
};

export type GithubIssueActivationChangedInput =
  | { kind: "label"; name: string }
  | { id: number; kind: "milestone"; title: string }
  | null;

export type NormalizedGithubIssueActivation = {
  action: string;
  actor: GithubIssueActivationActor;
  changedInput: GithubIssueActivationChangedInput;
  installationId: number;
  issue: {
    bodyPresent: boolean;
    isPullRequest: boolean;
    labels: string[];
    milestone: { id: number; title: string } | null;
    number: number;
    state: "closed" | "open";
  };
  repository: {
    fullName: string;
    id: number;
  };
};

export type GithubIssueActivationNormalizationResult =
  | { activation: NormalizedGithubIssueActivation; success: true }
  | { reason: string; success: false };

export type GithubIssueActivationTransitionDecision =
  | {
      changedInput: Exclude<GithubIssueActivationChangedInput, null> | null;
      outcome: "eligible";
      readinessAfter: true;
      readinessBefore: false;
    }
  | {
      changedInput: GithubIssueActivationChangedInput;
      outcome: "ignored" | "manifest_drift";
      readinessAfter: boolean;
      readinessBefore: boolean;
      reason: string;
    };

export type GithubIssueActivationPermissionDecision =
  | {
      decision: "authorized" | "unauthorized";
      permission: string;
      roleName: string;
    }
  | {
      decision: "indeterminate";
      reason: string;
    };

export type GithubIssueActivationPermissionResolver = {
  resolve(input: {
    actor: GithubIssueActivationActor;
    installationId: number;
    owner: string;
    repo: string;
  }): Promise<GithubIssueActivationPermissionDecision>;
};

type GithubIssueActivationPermissionClient = {
  request(
    route: "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
    input: { owner: string; repo: string; username: string },
  ): Promise<{ data: unknown }>;
};

type GithubServiceActorTuple = {
  actorId: number;
  installationId: number;
  repositoryId: number;
};

const transitionEvaluatorActions = new Set(["labeled", "milestoned", "opened", "reopened"]);
const knownBasePermissions = new Set(["admin", "none", "read", "write"]);
const standardAuthorizedRoles = new Set(["admin", "maintain", "triage", "write"]);
const standardRoleBasePermissions = new Map([
  ["admin", "admin"],
  ["maintain", "write"],
  ["none", "none"],
  ["read", "read"],
  ["triage", "read"],
  ["write", "write"],
]);
const activationEvidenceLimits = {
  action: 64,
  actorLogin: 100,
  labelCount: 100,
  labelName: 100,
  milestoneTitle: 256,
  repositoryFullName: 205,
  roleName: 100,
} as const;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  const normalized = nonEmptyString(value);
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeLabels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > activationEvidenceLimits.labelCount) return null;
  const labels: string[] = [];
  for (const entry of value) {
    const name = boundedString(object(entry)?.name, activationEvidenceLimits.labelName);
    if (!name) return null;
    labels.push(normalizeLabel(name));
  }
  return [...new Set(labels)];
}

function normalizeMilestone(value: unknown): { id: number; title: string } | null | undefined {
  if (value === null || value === undefined) return null;
  const milestone = object(value);
  const id = positiveInteger(milestone?.id);
  const title = boundedString(milestone?.title, activationEvidenceLimits.milestoneTitle);
  return id && title ? { id, title } : undefined;
}

export function normalizeGithubIssueActivationPayload(
  payload: unknown,
): GithubIssueActivationNormalizationResult {
  const root = object(payload);
  const issue = object(root?.issue);
  const sender = object(root?.sender);
  const repository = object(root?.repository);
  const installation = object(root?.installation);
  const action = boundedString(root?.action, activationEvidenceLimits.action)?.toLowerCase();
  const actorId = positiveInteger(sender?.id);
  const actorLogin = boundedString(sender?.login, activationEvidenceLimits.actorLogin);
  const repositoryId = positiveInteger(repository?.id);
  const repositoryFullName = boundedString(
    repository?.full_name,
    activationEvidenceLimits.repositoryFullName,
  );
  const installationId = positiveInteger(installation?.id);
  const issueNumber = positiveInteger(issue?.number);
  const issueState = issue?.state;
  const labels = normalizeLabels(issue?.labels);
  const issueMilestone = normalizeMilestone(issue?.milestone);

  if (
    !root ||
    !issue ||
    !action ||
    !actorId ||
    !actorLogin ||
    !repositoryId ||
    !repositoryFullName ||
    !installationId ||
    !issueNumber ||
    (issueState !== "open" && issueState !== "closed") ||
    !labels ||
    issueMilestone === undefined ||
    !/^[^/\s]+\/[^/\s]+$/.test(repositoryFullName)
  ) {
    return { reason: "invalid_activation_envelope", success: false };
  }

  let changedInput: GithubIssueActivationChangedInput = null;
  if (action === "labeled") {
    const changedLabel = boundedString(
      object(root.label)?.name,
      activationEvidenceLimits.labelName,
    );
    if (!changedLabel || !labels.includes(normalizeLabel(changedLabel))) {
      return { reason: "invalid_label_transition_evidence", success: false };
    }
    changedInput = { kind: "label", name: normalizeLabel(changedLabel) };
  } else if (action === "milestoned") {
    const changedMilestone = normalizeMilestone(root.milestone);
    if (
      !changedMilestone ||
      !issueMilestone ||
      changedMilestone.id !== issueMilestone.id ||
      changedMilestone.title !== issueMilestone.title
    ) {
      return { reason: "invalid_milestone_transition_evidence", success: false };
    }
    changedInput = { kind: "milestone", ...changedMilestone };
  }

  return {
    activation: {
      action,
      actor: { id: actorId, login: actorLogin },
      changedInput,
      installationId,
      issue: {
        bodyPresent: Boolean(nonEmptyString(issue.body)),
        isPullRequest: object(issue.pull_request) !== null,
        labels,
        milestone: issueMilestone,
        number: issueNumber,
        state: issueState,
      },
      repository: { fullName: repositoryFullName, id: repositoryId },
    },
    success: true,
  };
}

function evaluateReadiness(
  activation: NormalizedGithubIssueActivation,
  manifest: LoopDefinition,
  overrides: {
    labels?: string[];
    milestone?: { id: number; title: string } | null;
    state?: string;
  } = {},
): boolean {
  const labels = overrides.labels ?? activation.issue.labels;
  const configuredTriggerLabels = manifest.triggers.issueLabels.map(normalizeLabel);
  const readiness = evaluateGithubIssueReadiness(
    {
      body: activation.issue.bodyPresent ? "present" : "",
      labels: labels.map((name) => ({ name })),
      milestone:
        (overrides.milestone === undefined ? activation.issue.milestone : overrides.milestone) ??
        null,
      number: activation.issue.number,
      ...(activation.issue.isPullRequest ? { pull_request: {} } : {}),
      state: overrides.state ?? activation.issue.state,
    },
    {
      ...defaultGithubAgentReadyRules,
      blockedLabels: manifest.triggers.blockedLabels,
      readyLabels: configuredTriggerLabels,
    },
  ).ready;
  return readiness && configuredTriggerLabels.every((label) => labels.includes(label));
}

export function evaluateGithubIssueActivationTransition(input: {
  activation: NormalizedGithubIssueActivation;
  manifest: LoopDefinition;
}): GithubIssueActivationTransitionDecision {
  const { action, changedInput } = input.activation;
  const declaredActions = new Set<string>(input.manifest.triggers.issueStates);
  if (!declaredActions.has(action)) {
    return {
      changedInput,
      outcome: "ignored",
      readinessAfter: evaluateReadiness(input.activation, input.manifest),
      readinessBefore: false,
      reason: "action_not_declared",
    };
  }
  if (!transitionEvaluatorActions.has(action)) {
    return {
      changedInput,
      outcome: "manifest_drift",
      readinessAfter: evaluateReadiness(input.activation, input.manifest),
      readinessBefore: false,
      reason: "missing_transition_evaluator",
    };
  }

  const readinessAfter = evaluateReadiness(input.activation, input.manifest);
  let readinessBefore = false;
  if (action === "labeled") {
    if (changedInput?.kind !== "label") {
      return {
        changedInput,
        outcome: "ignored",
        readinessAfter,
        readinessBefore: false,
        reason: "missing_label_transition_evidence",
      };
    }
    if (!input.manifest.triggers.issueLabels.map(normalizeLabel).includes(changedInput.name)) {
      return {
        changedInput,
        outcome: "ignored",
        readinessAfter,
        readinessBefore: false,
        reason: "unrelated_label",
      };
    }
    readinessBefore = evaluateReadiness(input.activation, input.manifest, {
      labels: input.activation.issue.labels.filter((label) => label !== changedInput.name),
    });
  } else if (action === "milestoned") {
    if (changedInput?.kind !== "milestone") {
      return {
        changedInput,
        outcome: "ignored",
        readinessAfter,
        readinessBefore: false,
        reason: "missing_milestone_transition_evidence",
      };
    }
    readinessBefore = evaluateReadiness(input.activation, input.manifest, { milestone: null });
  }

  if (!readinessAfter || readinessBefore) {
    return {
      changedInput,
      outcome: "ignored",
      readinessAfter,
      readinessBefore,
      reason: readinessBefore ? "already_ready" : "readiness_not_satisfied",
    };
  }

  return {
    changedInput,
    outcome: "eligible",
    readinessAfter: true,
    readinessBefore: false,
  };
}

function requiredEnvironmentValue(name: "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY"): string {
  const value = readStringConfig(name);
  if (!value) throw new Error(`GitHub App configuration is missing ${name}.`);
  return value;
}

async function getDefaultInstallationClient(
  installationId: number,
): Promise<GithubIssueActivationPermissionClient> {
  const app = new App({
    appId: requiredEnvironmentValue("GITHUB_APP_ID"),
    privateKey: requiredEnvironmentValue("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
  return (await app.getInstallationOctokit(
    installationId,
  )) as unknown as GithubIssueActivationPermissionClient;
}

export function createGithubIssueActivationPermissionResolver(
  dependencies: {
    getInstallationClient?: (
      installationId: number,
    ) => Promise<GithubIssueActivationPermissionClient>;
  } = {},
): GithubIssueActivationPermissionResolver {
  const getInstallationClient = dependencies.getInstallationClient ?? getDefaultInstallationClient;

  return {
    async resolve(input) {
      try {
        const response = await (await getInstallationClient(input.installationId)).request(
          "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
          {
            owner: input.owner,
            repo: input.repo,
            username: input.actor.login,
          },
        );
        const data = object(response.data);
        const user = object(data?.user);
        const returnedId = positiveInteger(user?.id);
        const returnedLogin = boundedString(user?.login, activationEvidenceLimits.actorLogin);
        const permission = nonEmptyString(data?.permission)?.toLowerCase();
        const roleName = boundedString(
          data?.role_name,
          activationEvidenceLimits.roleName,
        )?.toLowerCase();
        if (
          !returnedId ||
          !returnedLogin ||
          returnedId !== input.actor.id ||
          returnedLogin.toLowerCase() !== input.actor.login.toLowerCase()
        ) {
          return { decision: "indeterminate", reason: "github_permission_identity_mismatch" };
        }
        if (!permission || !roleName || !knownBasePermissions.has(permission)) {
          return { decision: "indeterminate", reason: "github_permission_response_malformed" };
        }
        const expectedBasePermission = standardRoleBasePermissions.get(roleName);
        if (expectedBasePermission && expectedBasePermission !== permission) {
          return { decision: "indeterminate", reason: "github_permission_response_malformed" };
        }
        return {
          decision:
            permission === "admin" ||
            permission === "write" ||
            standardAuthorizedRoles.has(roleName)
              ? "authorized"
              : "unauthorized",
          permission,
          roleName,
        };
      } catch {
        return { decision: "indeterminate", reason: "github_permission_unavailable" };
      }
    },
  };
}

export function matchesGithubServiceActorException(
  input: GithubServiceActorTuple,
  configured: readonly GithubServiceActorTuple[],
): boolean {
  return configured.some(
    (entry) =>
      entry.actorId === input.actorId &&
      entry.repositoryId === input.repositoryId &&
      entry.installationId === input.installationId,
  );
}
