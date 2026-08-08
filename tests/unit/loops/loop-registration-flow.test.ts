/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

import {
  createLoopRegistrationFlow,
  type LoopRegistrationFormInput,
  type LoopRegistrationStore,
} from "@/lib/loops/loop-registration-flow";
import type {
  LoopRegistrationOutcome,
  TrackedRepository,
} from "@/lib/loops/loop-registration-store";

const now = new Date("2026-08-08T12:00:00.000Z");

const portal: TrackedRepository = {
  defaultBranch: "trunk",
  fullName: "loopworks-org/portal",
  id: "11111111-1111-4111-8111-111111111111",
  name: "portal",
  owner: "loopworks-org",
};

function form(overrides: Partial<LoopRegistrationFormInput> = {}): LoopRegistrationFormInput {
  return {
    enabled: true,
    issueLabels: ["agent-ready"],
    key: "development-loop",
    name: "Agent-ready development loop",
    repositoryId: portal.id,
    ...overrides,
  };
}

function flow(
  overrides: Partial<LoopRegistrationStore> = {},
  outcome: LoopRegistrationOutcome = "registered",
) {
  const register = vi.fn<LoopRegistrationStore["register"]>().mockResolvedValue(outcome);
  const store: LoopRegistrationStore = {
    listRegistered: vi.fn().mockResolvedValue([]),
    listTrackedRepositories: vi.fn().mockResolvedValue([portal]),
    register,
    ...overrides,
  };

  return { flow: createLoopRegistrationFlow({ now: () => now, store }), register, store };
}

describe("loop registration snapshot", () => {
  it("reports the tracked repositories an operator can scope a loop to", async () => {
    await expect(flow().flow.readRegistration()).resolves.toEqual({
      repositories: [portal],
      status: "ready",
    });
  });

  it("distinguishes an operator with no tracked repositories from a failed read", async () => {
    const empty = flow({ listTrackedRepositories: vi.fn().mockResolvedValue([]) });
    await expect(empty.flow.readRegistration()).resolves.toEqual({
      status: "no-tracked-repositories",
    });

    const broken = flow({
      listTrackedRepositories: vi.fn().mockRejectedValue(new Error("catalog_unreachable")),
    });
    await expect(broken.flow.readRegistration()).resolves.toEqual({
      reason: "catalog_unreachable",
      status: "error",
    });
  });
});

describe("loop registration", () => {
  it("registers the composed definition against the chosen repository", async () => {
    const context = flow();

    await expect(context.flow.registerLoop(form())).resolves.toEqual({
      loopKey: "development-loop",
      status: "registered",
    });

    expect(context.register).toHaveBeenCalledTimes(1);
    const [call] = context.register.mock.calls;
    expect(call?.[0].repositoryId).toBe(portal.id);
    expect(call?.[0].now).toBe(now);
    // Repository scope comes from the tracked row, never from the submitted form.
    expect(call?.[0].definition.repoScope).toEqual({
      branchPatterns: ["trunk"],
      includeForks: false,
      repositories: ["loopworks-org/portal"],
    });
  });

  it("refuses a repository id the catalog does not know, without writing", async () => {
    const context = flow();

    await expect(
      context.flow.registerLoop(form({ repositoryId: "99999999-9999-4999-8999-999999999999" })),
    ).resolves.toEqual({ status: "repository-missing" });
    expect(context.register).not.toHaveBeenCalled();
  });

  it("returns manifest validation errors without writing", async () => {
    const context = flow();

    const result = await context.flow.registerLoop(form({ issueLabels: [] }));

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors.some((entry) => entry.path === "triggers.issueLabels")).toBe(true);
    expect(context.register).not.toHaveBeenCalled();
  });

  it("passes a duplicate key through as its own outcome rather than an error", async () => {
    const context = flow({}, "duplicate-key");
    await expect(context.flow.registerLoop(form())).resolves.toEqual({ status: "duplicate-key" });
  });

  it("reports a store failure as an error instead of throwing", async () => {
    const context = flow({
      register: vi.fn().mockRejectedValue(new Error("store_unreachable")),
    });

    await expect(context.flow.registerLoop(form())).resolves.toEqual({
      reason: "store_unreachable",
      status: "error",
    });
  });
});
