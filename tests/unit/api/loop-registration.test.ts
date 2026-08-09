/** @vitest-environment node */

import { handleLoopRegistrationApply, handleLoopRegistrationRead } from "@/app/api/loops/route";
import type {
  LoopRegistrationFormInput,
  LoopRegistrationResult,
  LoopRegistrationSnapshot,
} from "@/lib/loops/loop-registration-flow";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const actorId = "ncolesummers";

function authenticated() {
  return vi.fn().mockResolvedValue({ actorId, authenticated: true });
}

function unauthenticated() {
  return vi.fn().mockResolvedValue({
    authenticated: false,
    response: new Response("Authentication required", { status: 401 }) as never,
  });
}

function postRequest(body: unknown, raw?: string) {
  return new Request("https://loopworks.local/api/loops", {
    body: raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function readRequest() {
  return new Request("https://loopworks.local/api/loops");
}

const validBody = {
  enabled: true,
  issueLabels: ["agent-ready"],
  key: "development-loop",
  name: "Agent-ready development loop",
  repositoryId: "11111111-1111-4111-8111-111111111111",
};

describe("GET /api/loops", () => {
  it("refuses an unauthenticated read before touching the store", async () => {
    const readRegistration = vi.fn<() => Promise<LoopRegistrationSnapshot>>();

    const response = await handleLoopRegistrationRead(readRequest(), {
      readRegistration,
      requireSession: unauthenticated(),
    });

    expect(response.status).toBe(401);
    expect(readRegistration).not.toHaveBeenCalled();
  });

  it("returns the registration snapshot", async () => {
    const snapshot: LoopRegistrationSnapshot = {
      repositories: [
        {
          defaultBranch: "main",
          fullName: "loopworks-org/portal",
          id: validBody.repositoryId,
          name: "portal",
          owner: "loopworks-org",
        },
      ],
      status: "ready",
    };

    const response = await handleLoopRegistrationRead(readRequest(), {
      readRegistration: vi.fn().mockResolvedValue(snapshot),
      requireSession: authenticated(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("reports a failed read as 502 without leaking the upstream reason", async () => {
    const response = await handleLoopRegistrationRead(readRequest(), {
      readRegistration: vi
        .fn()
        .mockResolvedValue({ reason: "postgres://user:secret@host", status: "error" }),
      requireSession: authenticated(),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ status: "error" });
  });

  it("does not surface a thrown runtime construction failure as a 500", async () => {
    const response = await handleLoopRegistrationRead(readRequest(), {
      readRegistration: vi.fn().mockRejectedValue(new Error("config_invalid")),
      requireSession: authenticated(),
    });

    expect(response.status).toBe(502);
  });
});

describe("POST /api/loops", () => {
  it("refuses an unauthenticated write before touching the store", async () => {
    const registerLoop =
      vi.fn<(input: LoopRegistrationFormInput) => Promise<LoopRegistrationResult>>();
    const recordLoopRegistrationOutcomeMetric = vi.fn();

    const response = await handleLoopRegistrationApply(postRequest(validBody), {
      recordLoopRegistrationOutcomeMetric,
      registerLoop,
      requireSession: unauthenticated(),
    });

    expect(response.status).toBe(401);
    expect(registerLoop).not.toHaveBeenCalled();
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledOnce();
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledWith({
      outcome: "unauthenticated",
    });
  });

  it("registers a loop and reports 201 with its key", async () => {
    const registerLoop = vi
      .fn()
      .mockResolvedValue({ loopKey: "development-loop", status: "registered" });
    const recordLoopRegistrationOutcomeMetric = vi.fn();

    const response = await handleLoopRegistrationApply(postRequest(validBody), {
      recordLoopRegistrationOutcomeMetric,
      registerLoop,
      requireSession: authenticated(),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      loopKey: "development-loop",
      status: "registered",
    });
    expect(registerLoop).toHaveBeenCalledWith({
      enabled: true,
      issueLabels: ["agent-ready"],
      key: "development-loop",
      name: "Agent-ready development loop",
      repositoryId: validBody.repositoryId,
    });
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledOnce();
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledWith({ outcome: "registered" });
  });

  it.each([
    ["malformed json", undefined, "{"],
    ["a non-object body", [], undefined],
    ["a missing repository id", { ...validBody, repositoryId: undefined }, undefined],
    ["a non-string name", { ...validBody, name: 42 }, undefined],
    ["a non-boolean enabled flag", { ...validBody, enabled: "yes" }, undefined],
    ["non-string trigger labels", { ...validBody, issueLabels: [1] }, undefined],
    ["a non-array issueLabels", { ...validBody, issueLabels: "agent-ready" }, undefined],
  ])("rejects %s as an invalid request without touching the store", async (_label, body, raw) => {
    const registerLoop = vi.fn();
    const recordLoopRegistrationOutcomeMetric = vi.fn();

    const response = await handleLoopRegistrationApply(postRequest(body, raw), {
      recordLoopRegistrationOutcomeMetric,
      registerLoop,
      requireSession: authenticated(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: "invalid-request" });
    expect(registerLoop).not.toHaveBeenCalled();
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledOnce();
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledWith({
      outcome: "invalid-request",
    });
  });

  it.each([
    [{ errors: [], status: "invalid" }, "invalid"],
    [{ status: "duplicate-key" }, "duplicate-key"],
    [{ status: "repository-missing" }, "repository-missing"],
    [{ reason: "store_unreachable", status: "error" }, "error"],
  ] as const)("records the %s flow outcome", async (result, outcome) => {
    const recordLoopRegistrationOutcomeMetric = vi.fn();

    await handleLoopRegistrationApply(postRequest(validBody), {
      recordLoopRegistrationOutcomeMetric,
      registerLoop: vi.fn().mockResolvedValue(result),
      requireSession: authenticated(),
    });

    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledOnce();
    expect(recordLoopRegistrationOutcomeMetric).toHaveBeenCalledWith({ outcome });
  });

  it("returns manifest validation errors as 400 so the form can render them", async () => {
    const errors = [
      {
        hint: "Add at least one GitHub label that can trigger the loop, such as agent-ready.",
        message: "Too small: expected array to have >=1 items",
        path: "triggers.issueLabels",
      },
    ];

    const response = await handleLoopRegistrationApply(
      postRequest({ ...validBody, issueLabels: [] }),
      {
        registerLoop: vi.fn().mockResolvedValue({ errors, status: "invalid" }),
        requireSession: authenticated(),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ errors, status: "invalid" });
  });

  it("passes manifest-owned string content to the manifest validation boundary", async () => {
    const errors = [
      {
        hint: "Provide a human-readable loop name.",
        message: "Too small: expected string to have >=1 characters",
        path: "name",
      },
    ];
    const registerLoop = vi.fn().mockResolvedValue({ errors, status: "invalid" });

    const response = await handleLoopRegistrationApply(postRequest({ ...validBody, name: "" }), {
      registerLoop,
      requireSession: authenticated(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ errors, status: "invalid" });
    expect(registerLoop).toHaveBeenCalledWith({ ...validBody, name: "" });
  });

  it("does not invent request-layer limits for schema-valid manifest fields", async () => {
    const longName = "a".repeat(201);
    const issueLabels = Array.from({ length: 21 }, (_, index) => `trigger-${index}`);
    const registerLoop = vi
      .fn()
      .mockResolvedValue({ loopKey: "development-loop", status: "registered" });

    const response = await handleLoopRegistrationApply(
      postRequest({ ...validBody, issueLabels, name: longName }),
      { registerLoop, requireSession: authenticated() },
    );

    expect(response.status).toBe(201);
    expect(registerLoop).toHaveBeenCalledWith({ ...validBody, issueLabels, name: longName });
  });

  it("reports a duplicate key as 409 and a missing repository as 422", async () => {
    const duplicate = await handleLoopRegistrationApply(postRequest(validBody), {
      registerLoop: vi.fn().mockResolvedValue({ status: "duplicate-key" }),
      requireSession: authenticated(),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ status: "duplicate-key" });

    const missing = await handleLoopRegistrationApply(postRequest(validBody), {
      registerLoop: vi.fn().mockResolvedValue({ status: "repository-missing" }),
      requireSession: authenticated(),
    });
    expect(missing.status).toBe(422);
    await expect(missing.json()).resolves.toEqual({ status: "repository-missing" });
  });

  it("reports a store failure as 502 without leaking the upstream reason", async () => {
    const response = await handleLoopRegistrationApply(postRequest(validBody), {
      registerLoop: vi
        .fn()
        .mockResolvedValue({ reason: "postgres://user:secret@host", status: "error" }),
      requireSession: authenticated(),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ status: "error" });
  });

  it("does not surface a thrown store failure as a 500", async () => {
    const response = await handleLoopRegistrationApply(postRequest(validBody), {
      registerLoop: vi.fn().mockRejectedValue(new Error("store_unreachable")),
      requireSession: authenticated(),
    });

    expect(response.status).toBe(502);
  });
});
