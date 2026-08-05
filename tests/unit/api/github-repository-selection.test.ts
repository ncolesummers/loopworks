/** @vitest-environment node */

import {
  handleGithubRepositorySelectionApply,
  handleGithubRepositorySelectionRead,
} from "@/app/api/github/repositories/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const authenticated = async () => ({ actorId: "ncolesummers", authenticated: true }) as const;

function applyRequest(body: unknown) {
  return new Request("https://loopworks.local/api/github/repositories", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("GitHub repository selection route", () => {
  it("requires a session before reading the selection surface", async () => {
    const readSelection = vi.fn();
    const response = await handleGithubRepositorySelectionRead(
      new Request("https://loopworks.local/api/github/repositories"),
      {
        readSelection,
        requireSession: async () => ({
          authenticated: false,
          response: new Response("Authentication required", { status: 401 }) as never,
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(readSelection).not.toHaveBeenCalled();
  });

  it("requires a session before applying a selection", async () => {
    const applySelection = vi.fn();
    const response = await handleGithubRepositorySelectionApply(
      applyRequest({ deselect: [], select: [900_001] }),
      {
        applySelection,
        requireSession: async () => ({
          authenticated: false,
          response: new Response("Authentication required", { status: 401 }) as never,
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(applySelection).not.toHaveBeenCalled();
  });

  it("returns the selection snapshot for an authenticated operator", async () => {
    const response = await handleGithubRepositorySelectionRead(
      new Request("https://loopworks.local/api/github/repositories"),
      {
        readSelection: async () => ({
          installation: {
            accountLogin: "loopworks-org",
            accountType: "Organization",
            appId: 124,
            installationId: 124_001,
            repositorySelection: "selected",
          },
          repositories: [],
          status: "no-accessible-repositories" as const,
        }),
        requireSession: authenticated,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "no-accessible-repositories",
    });
  });

  it("reports an upstream failure as 502 without leaking the provider message", async () => {
    const response = await handleGithubRepositorySelectionRead(
      new Request("https://loopworks.local/api/github/repositories"),
      {
        readSelection: async () => ({
          reason: "github token 1234 rejected",
          status: "error" as const,
        }),
        requireSession: authenticated,
      },
    );

    expect(response.status).toBe(502);
    const payload = await response.text();
    expect(payload).not.toContain("1234");
    expect(JSON.parse(payload)).toEqual({ status: "error" });
  });

  it("rejects a malformed body without calling the selection flow", async () => {
    const applySelection = vi.fn();
    for (const body of [
      "not json",
      { select: "900001" },
      { select: [900_001.5] },
      { select: [-1] },
      { deselect: [Number.MAX_SAFE_INTEGER + 2] },
      { select: Array.from({ length: 501 }, (_value, index) => index + 1) },
    ]) {
      const response = await handleGithubRepositorySelectionApply(applyRequest(body), {
        applySelection,
        requireSession: authenticated,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    expect(applySelection).not.toHaveBeenCalled();
  });

  it("applies a well-formed selection and returns per-repository outcomes", async () => {
    const applySelection = vi.fn(async () => ({
      outcomes: [{ githubRepoId: 900_001, outcome: "selected" as const }],
      status: "applied" as const,
    }));
    const response = await handleGithubRepositorySelectionApply(
      applyRequest({ deselect: [], select: [900_001] }),
      { applySelection, requireSession: authenticated },
    );

    expect(applySelection).toHaveBeenCalledWith({ deselect: [], select: [900_001] });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcomes: [{ githubRepoId: 900_001, outcome: "selected" }],
      status: "applied",
    });
  });

  it("rejects duplicate or overlapping repository ids", async () => {
    const applySelection = vi.fn();
    for (const body of [
      { deselect: [900_001], select: [900_001] },
      { select: [900_001, 900_001] },
      { deselect: [900_002, 900_002] },
    ]) {
      const response = await handleGithubRepositorySelectionApply(applyRequest(body), {
        applySelection,
        requireSession: authenticated,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    expect(applySelection).not.toHaveBeenCalled();
  });

  it("returns committed outcomes with a partial status instead of a bare error", async () => {
    const response = await handleGithubRepositorySelectionApply(
      applyRequest({ deselect: [], select: [900_001, 900_002] }),
      {
        applySelection: async () => ({
          outcomes: [{ githubRepoId: 900_001, outcome: "selected" as const }],
          reason: "connection terminated for user hunter2",
          status: "partial" as const,
        }),
        requireSession: authenticated,
      },
    );

    expect(response.status).toBe(207);
    const payload = await response.text();
    expect(payload).not.toContain("hunter2");
    expect(JSON.parse(payload)).toEqual({
      outcomes: [{ githubRepoId: 900_001, outcome: "selected" }],
      status: "partial",
    });
  });

  it("degrades to 502 when the selection runtime cannot be constructed", async () => {
    const readResponse = await handleGithubRepositorySelectionRead(
      new Request("https://loopworks.local/api/github/repositories"),
      {
        readSelection: async () => {
          throw new Error("github_installation_configuration_invalid");
        },
        requireSession: authenticated,
      },
    );
    const applyResponse = await handleGithubRepositorySelectionApply(
      applyRequest({ deselect: [], select: [900_001] }),
      {
        applySelection: async () => {
          throw new Error("github_installation_configuration_invalid");
        },
        requireSession: authenticated,
      },
    );

    expect(readResponse.status).toBe(502);
    expect(applyResponse.status).toBe(502);
    await expect(applyResponse.json()).resolves.toEqual({ status: "error" });
  });

  it("reports an apply against no connected installation as 409", async () => {
    const response = await handleGithubRepositorySelectionApply(
      applyRequest({ deselect: [], select: [900_001] }),
      {
        applySelection: async () => ({ status: "not-connected" as const }),
        requireSession: authenticated,
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ status: "not-connected" });
  });
});
