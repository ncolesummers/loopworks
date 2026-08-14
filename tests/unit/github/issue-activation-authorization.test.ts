/** @vitest-environment node */

import { generateKeyPairSync } from "node:crypto";

import { HttpResponse, http } from "msw";

import {
  createGithubIssueActivationPermissionResolver,
  evaluateGithubIssueActivationTransition,
  matchesGithubServiceActorException,
  normalizeGithubIssueActivationPayload,
} from "@/lib/github/issue-activation-authorization";
import { defaultLoopManifest } from "@/lib/loops/manifest";

import { mswServer } from "../../helpers/msw";

const actor = { id: 22_808_397, login: "ncolesummers" };
const repository = { full_name: "ncolesummers/loopworks", id: 81_000_001 };
const installation = { id: 124_001 };

function readyIssue(overrides: Record<string, unknown> = {}) {
  return {
    body: "Implement the authorized activation boundary.",
    labels: [{ name: "agent-ready" }, { name: "area:github" }, { name: "priority:p0" }],
    milestone: { id: 31, title: "M5 Security" },
    number: 256,
    state: "open",
    ...overrides,
  };
}

function payload(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    installation,
    issue: readyIssue(),
    label: { name: "agent-ready" },
    repository,
    sender: actor,
    ...overrides,
  };
}

function normalized(action: string, overrides: Record<string, unknown> = {}) {
  const result = normalizeGithubIssueActivationPayload(payload(action, overrides));
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.reason);
  return result.activation;
}

function developmentManifest() {
  const manifest = defaultLoopManifest.loops.find((loop) => loop.key === "development-loop");
  if (!manifest) throw new Error("missing development-loop manifest");
  return manifest;
}

describe("GitHub issue activation normalization", () => {
  it("retains only immutable binding and bounded readiness evidence", () => {
    const result = normalizeGithubIssueActivationPayload(
      payload("labeled", {
        issue: readyIssue({
          body: "raw issue body must not cross the authorization envelope",
          title: "raw issue title must not cross the authorization envelope",
        }),
      }),
    );

    expect(result).toMatchObject({
      success: true,
      activation: {
        action: "labeled",
        actor,
        changedInput: { kind: "label", name: "agent-ready" },
        installationId: 124_001,
        issue: {
          bodyPresent: true,
          labels: ["agent-ready", "area:github", "priority:p0"],
          milestone: { id: 31, title: "M5 Security" },
          number: 256,
          state: "open",
        },
        repository: { fullName: "ncolesummers/loopworks", id: 81_000_001 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("raw issue body");
    expect(JSON.stringify(result)).not.toContain("raw issue title");
    expect(JSON.stringify(result)).not.toMatch(/token|credential|signature/i);
  });

  it.each([
    ["missing sender", { sender: undefined }],
    ["missing installation", { installation: undefined }],
    ["missing repository id", { repository: { full_name: repository.full_name } }],
    ["missing changed label", { label: undefined }],
    [
      "mismatched changed label",
      { label: { name: "agent-ready" }, issue: readyIssue({ labels: [] }) },
    ],
  ])("fails closed on %s", (_name, overrides) => {
    expect(normalizeGithubIssueActivationPayload(payload("labeled", overrides))).toMatchObject({
      success: false,
    });
  });

  it.each([
    ["oversized action", payload("x".repeat(65), { label: undefined })],
    ["oversized actor login", payload("opened", { sender: { ...actor, login: "x".repeat(101) } })],
    [
      "too many labels",
      payload("opened", {
        issue: readyIssue({
          labels: Array.from({ length: 101 }, (_, index) => ({ name: `l${index}` })),
        }),
        label: undefined,
      }),
    ],
    [
      "oversized label",
      payload("labeled", {
        issue: readyIssue({ labels: [{ name: "x".repeat(101) }] }),
        label: { name: "x".repeat(101) },
      }),
    ],
    [
      "oversized milestone title",
      payload("milestoned", {
        issue: readyIssue({ milestone: { id: 31, title: "x".repeat(257) } }),
        label: undefined,
        milestone: { id: 31, title: "x".repeat(257) },
      }),
    ],
  ])("rejects %s rather than persisting unbounded evidence", (_name, candidate) => {
    expect(normalizeGithubIssueActivationPayload(candidate)).toMatchObject({ success: false });
  });
});

describe("GitHub issue activation transition decisions", () => {
  it.each(["opened", "reopened"])(
    "recognizes the exact not-ready to ready %s transition",
    (action) => {
      expect(
        evaluateGithubIssueActivationTransition({
          activation: normalized(action, { label: undefined }),
          manifest: developmentManifest(),
        }),
      ).toMatchObject({
        outcome: "eligible",
        readinessAfter: true,
        readinessBefore: false,
      });
    },
  );

  it("requires labeled to deliver the final configured ready label", () => {
    expect(
      evaluateGithubIssueActivationTransition({
        activation: normalized("labeled"),
        manifest: developmentManifest(),
      }),
    ).toMatchObject({
      changedInput: { kind: "label", name: "agent-ready" },
      outcome: "eligible",
      readinessAfter: true,
      readinessBefore: false,
    });

    const unrelated = normalized("labeled", {
      label: { name: "area:github" },
    });
    expect(
      evaluateGithubIssueActivationTransition({
        activation: unrelated,
        manifest: developmentManifest(),
      }),
    ).toMatchObject({ outcome: "ignored", reason: "unrelated_label" });
  });

  it("derives exact labeled transitions from all applicable manifest trigger labels", () => {
    const research = defaultLoopManifest.loops.find((loop) => loop.key === "research-loop");
    if (!research) throw new Error("missing research-loop manifest");
    expect(
      evaluateGithubIssueActivationTransition({
        activation: normalized("labeled", {
          issue: readyIssue({
            labels: [
              { name: "agent-ready" },
              { name: "spike" },
              { name: "area:github" },
              { name: "priority:p0" },
            ],
          }),
          label: { name: "spike" },
        }),
        manifest: research,
      }),
    ).toMatchObject({ outcome: "eligible", readinessAfter: true, readinessBefore: false });

    const releaseManifest = {
      ...developmentManifest(),
      triggers: { ...developmentManifest().triggers, issueLabels: ["release-ready"] },
    };
    expect(
      evaluateGithubIssueActivationTransition({
        activation: normalized("labeled", {
          issue: readyIssue({
            labels: [{ name: "release-ready" }, { name: "area:github" }, { name: "priority:p0" }],
          }),
          label: { name: "release-ready" },
        }),
        manifest: releaseManifest,
      }),
    ).toMatchObject({ outcome: "eligible" });
    expect(
      evaluateGithubIssueActivationTransition({
        activation: normalized("labeled"),
        manifest: releaseManifest,
      }),
    ).toMatchObject({ outcome: "ignored" });
  });

  it("recognizes a final milestone transition using matching delivered evidence", () => {
    const activation = normalized("milestoned", {
      label: undefined,
      milestone: { id: 31, title: "M5 Security" },
    });

    expect(
      evaluateGithubIssueActivationTransition({
        activation,
        manifest: developmentManifest(),
      }),
    ).toMatchObject({
      changedInput: { id: 31, kind: "milestone", title: "M5 Security" },
      outcome: "eligible",
      readinessAfter: true,
      readinessBefore: false,
    });
  });

  it("ignores excluded actions and fails closed on declared evaluator drift", () => {
    expect(
      evaluateGithubIssueActivationTransition({
        activation: normalized("edited", { label: undefined }),
        manifest: developmentManifest(),
      }),
    ).toMatchObject({ outcome: "ignored", reason: "action_not_declared" });

    expect(
      evaluateGithubIssueActivationTransition({
        activation: normalized("edited", { label: undefined }),
        manifest: {
          ...developmentManifest(),
          triggers: { ...developmentManifest().triggers, issueStates: ["edited"] },
        },
      }),
    ).toMatchObject({ outcome: "manifest_drift", reason: "missing_transition_evaluator" });
  });
});

describe("GitHub issue activation permission policy", () => {
  const input = {
    actor,
    installationId: 124_001,
    owner: "ncolesummers",
    repo: "loopworks",
  };

  it.each([
    ["triage", "read"],
    ["write", "write"],
    ["maintain", "write"],
    ["admin", "admin"],
    ["custom-security-manager", "write"],
  ])("authorizes role %s with base permission %s", async (roleName, permission) => {
    const resolver = createGithubIssueActivationPermissionResolver({
      getInstallationClient: async () => ({
        request: vi.fn(async () => ({
          data: { permission, role_name: roleName, user: actor },
        })),
      }),
    });

    await expect(resolver.resolve(input)).resolves.toMatchObject({
      decision: "authorized",
      permission,
      roleName,
    });
  });

  it("denies permissions below triage", async () => {
    const resolver = createGithubIssueActivationPermissionResolver({
      getInstallationClient: async () => ({
        request: vi.fn(async () => ({
          data: { permission: "read", role_name: "read", user: actor },
        })),
      }),
    });

    await expect(resolver.resolve(input)).resolves.toMatchObject({
      decision: "unauthorized",
      permission: "read",
      roleName: "read",
    });
  });

  it.each([
    ["malformed", async () => ({ data: { permission: "write" } })],
    [
      "oversized role name",
      async () => ({
        data: { permission: "write", role_name: "x".repeat(101), user: actor },
      }),
    ],
    [
      "contradictory admin role",
      async () => ({ data: { permission: "none", role_name: "admin", user: actor } }),
    ],
    [
      "contradictory triage role",
      async () => ({ data: { permission: "none", role_name: "triage", user: actor } }),
    ],
    [
      "contradictory base permission",
      async () => ({ data: { permission: "read", role_name: "admin", user: actor } }),
    ],
    [
      "identity mismatch",
      async () => ({
        data: { permission: "admin", role_name: "admin", user: { id: 9, login: "impostor" } },
      }),
    ],
    [
      "401",
      async () => {
        throw Object.assign(new Error("401"), { status: 401 });
      },
    ],
    [
      "403",
      async () => {
        throw Object.assign(new Error("403"), { status: 403 });
      },
    ],
    [
      "404",
      async () => {
        throw Object.assign(new Error("404"), { status: 404 });
      },
    ],
    [
      "429",
      async () => {
        throw Object.assign(new Error("429"), { status: 429 });
      },
    ],
    [
      "5xx",
      async () => {
        throw Object.assign(new Error("503"), { status: 503 });
      },
    ],
    [
      "network",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("classifies %s permission resolution as indeterminate", async (_name, request) => {
    const resolver = createGithubIssueActivationPermissionResolver({
      getInstallationClient: async () => ({ request: vi.fn(request) }),
    });

    await expect(resolver.resolve(input)).resolves.toMatchObject({ decision: "indeterminate" });
  });

  it("exercises the default installation-authenticated Octokit client through MSW", async () => {
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    }).privateKey;
    vi.stubEnv("GITHUB_APP_ID", "124");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);
    const authorizationHeaders: Array<string | null> = [];
    mswServer.use(
      http.post("https://api.github.com/app/installations/124001/access_tokens", () =>
        HttpResponse.json({ token: "ghs_installation" }, { status: 201 }),
      ),
      http.get(
        "https://api.github.com/repos/ncolesummers/loopworks/collaborators/ncolesummers/permission",
        ({ request }) => {
          authorizationHeaders.push(request.headers.get("authorization"));
          return HttpResponse.json({
            permission: "read",
            role_name: "triage",
            user: actor,
          });
        },
      ),
    );

    const resolver = createGithubIssueActivationPermissionResolver();
    await expect(resolver.resolve(input)).resolves.toMatchObject({ decision: "authorized" });
    expect(authorizationHeaders).toEqual(["token ghs_installation"]);
  });

  it("has no service-actor exception and requires an exact immutable tuple if one is added", () => {
    const tuple = { actorId: 41_982, installationId: 124_001, repositoryId: 81_000_001 };
    expect(matchesGithubServiceActorException(tuple, [])).toBe(false);
    expect(matchesGithubServiceActorException(tuple, [tuple])).toBe(true);
    expect(matchesGithubServiceActorException({ ...tuple, actorId: 41_983 }, [tuple])).toBe(false);
    expect(
      matchesGithubServiceActorException({ ...tuple, repositoryId: 81_000_002 }, [tuple]),
    ).toBe(false);
    expect(matchesGithubServiceActorException({ ...tuple, installationId: 124_002 }, [tuple])).toBe(
      false,
    );
  });
});
