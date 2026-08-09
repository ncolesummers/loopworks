/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  firstLoopRegistrationDefaults,
  type LoopRegistrationInput,
  validateLoopRegistration,
} from "@/lib/loops/loop-registration";
import { defaultLoopManifest } from "@/lib/loops/manifest";

function input(overrides: Partial<LoopRegistrationInput> = {}): LoopRegistrationInput {
  return {
    defaultBranch: "main",
    enabled: true,
    issueLabels: ["agent-ready"],
    key: "development-loop",
    name: "Agent-ready development loop",
    repositoryFullName: "loopworks-org/portal",
    ...overrides,
  };
}

const template = defaultLoopManifest.loops.find((loop) => loop.key === "development-loop");

if (!template) throw new Error("defaultLoopManifest has no development-loop");

describe("first loop registration defaults", () => {
  it("offers a development loop the operator does not have to author by hand", () => {
    expect(firstLoopRegistrationDefaults).toEqual({
      issueLabels: template.triggers.issueLabels,
      key: template.key,
      name: template.name,
    });
  });

  it("carries every bounded policy across from the shipped development loop", () => {
    const result = validateLoopRegistration(input());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.definition.budgets).toEqual(template.budgets);
    expect(result.definition.modelPolicy).toEqual(template.modelPolicy);
    expect(result.definition.toolPolicy).toEqual(template.toolPolicy);
    expect(result.definition.retryPolicy).toEqual(template.retryPolicy);
    expect(result.definition.approvals).toEqual(template.approvals);
    expect(result.definition.validationGates).toEqual(template.validationGates);
    expect(result.definition.artifacts).toEqual(template.artifacts);
    expect(result.definition.reconciliation).toEqual(template.reconciliation);
    expect(result.definition.cancellation).toEqual(template.cancellation);
  });

  it("scopes the definition to the chosen repository and its default branch", () => {
    const result = validateLoopRegistration(
      input({ defaultBranch: "trunk", repositoryFullName: "loopworks-org/agent" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.definition.repoScope).toEqual({
      branchPatterns: ["trunk"],
      includeForks: false,
      repositories: ["loopworks-org/agent"],
    });
  });

  it("resolves the concurrency group placeholder to the canonical repository", () => {
    // The stored contract must not carry `{repo}`: admission rejects any unresolved placeholder.
    expect(template.concurrency.group).toContain("{repo}");

    const result = validateLoopRegistration(input());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.definition.concurrency.group).toBe("repo:loopworks-org/portal:loop:development");
    expect(result.definition.concurrency.group).not.toContain("{repo}");
  });

  it("applies the operator's key, name, trigger labels, and enabled state", () => {
    const result = validateLoopRegistration(
      input({
        enabled: false,
        issueLabels: ["agent-ready", "status:ready"],
        key: "portal-loop",
        name: "Portal delivery loop",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.definition.enabled).toBe(false);
    expect(result.definition.key).toBe("portal-loop");
    expect(result.definition.name).toBe("Portal delivery loop");
    expect(result.definition.triggers.issueLabels).toEqual(["agent-ready", "status:ready"]);
    // Untouched trigger fields keep the shipped contract.
    expect(result.definition.triggers.issueStates).toEqual(template.triggers.issueStates);
    expect(result.definition.triggers.blockedLabels).toEqual(template.triggers.blockedLabels);
  });

  it("does not mutate the shared default manifest", () => {
    validateLoopRegistration(input({ issueLabels: ["something-else"] }));

    expect(defaultLoopManifest.loops[0]?.triggers.issueLabels).toEqual(
      template.triggers.issueLabels,
    );
    expect(defaultLoopManifest.loops[0]?.repoScope.repositories).toEqual(
      template.repoScope.repositories,
    );
  });
});

describe("first loop registration validation", () => {
  it("reports an empty trigger label list against the operator-facing field path", () => {
    const result = validateLoopRegistration(input({ issueLabels: [] }));

    expect(result.success).toBe(false);
    if (result.success) return;

    const error = result.errors.find((entry) => entry.path === "triggers.issueLabels");
    expect(error).toBeDefined();
    // Hint text comes from the manifest module's existing cascade, not a second copy of it.
    expect(error?.hint).toBe(
      "Add at least one GitHub label that can trigger the loop, such as agent-ready.",
    );
    // The manifest index is an implementation detail of the compose step, not operator vocabulary.
    expect(result.errors.every((entry) => !entry.path.includes("loops[0]"))).toBe(true);
  });

  it("reports an invalid loop key", () => {
    const result = validateLoopRegistration(input({ key: "Development Loop" }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((entry) => entry.path === "key")).toBe(true);
  });

  it("reports a malformed repository slug once, not once per manifest field", () => {
    const result = validateLoopRegistration(input({ repositoryFullName: "portal" }));

    expect(result.success).toBe(false);
    if (result.success) return;

    const repositoryErrors = result.errors.filter((entry) => entry.path === "repositoryFullName");
    expect(repositoryErrors).toHaveLength(1);
    expect(repositoryErrors[0]?.hint).toBe(
      "Use an owner/repo slug such as ncolesummers/loopworks.",
    );
  });

  it("reports a blank name and a blank default branch", () => {
    const result = validateLoopRegistration(input({ defaultBranch: "", name: "" }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((entry) => entry.path === "name")).toBe(true);
    expect(result.errors.some((entry) => entry.path.startsWith("repoScope.branchPatterns"))).toBe(
      true,
    );
  });

  it("carries hint text for every reported error so no message is a bare Zod string", () => {
    const result = validateLoopRegistration(input({ issueLabels: [], key: "Bad Key" }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.length).toBeGreaterThan(1);
    for (const error of result.errors) {
      expect(error.hint.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
