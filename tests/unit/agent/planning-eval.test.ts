import { describe, expect, it } from "vitest";

import sandbox from "../../../agent/sandbox";
import {
  getPlanningArtifactCandidate,
  planningEvalTimeoutMs,
  parsePlanningArtifactReply,
  readIssueFixture,
  resolveIssueFixturePath,
} from "../../../evals/planning/issue-13-plan.eval";
import { createPlanningAgentSeedPlan } from "../../../agent/planning-agent";

function resolveSandboxBackendName(): string {
  const backend = typeof sandbox.backend === "function" ? sandbox.backend() : sandbox.backend;
  if (!backend) {
    throw new Error("Planning sandbox backend is not configured.");
  }

  return backend.name;
}

describe("planning eval fixture loading", () => {
  it("loads issue fixtures from the repository root instead of the authored-module cache", async () => {
    expect(resolveIssueFixturePath().endsWith("evals/planning/fixtures/issue-13.json")).toBe(true);

    const fixture = await readIssueFixture();

    expect(fixture).toMatchObject({
      issueNumber: 13,
      repositoryFullName: "ncolesummers/loopworks",
      title: "Initial Eve planning agent",
    });
    expect(fixture.body).toContain("Acceptance Criteria");
  });

  it("parses JSON reply artifacts when Eve exposes the final message as output", () => {
    const artifact = createPlanningAgentSeedPlan({
      body: "## Acceptance Criteria\n- Artifact is valid.",
      issueNumber: 13,
      labels: ["loop:development"],
      milestone: null,
      repositoryFullName: "ncolesummers/loopworks",
      title: "Initial Eve planning agent",
    });

    expect(parsePlanningArtifactReply(JSON.stringify(artifact))).toMatchObject({
      model: "openai/gpt-5.5-xhigh",
      issue: { number: 13 },
    });
    expect(
      getPlanningArtifactCandidate(undefined, null, [
        { name: "emit_plan_artifact", output: artifact },
      ]),
    ).toMatchObject({
      issue: { number: 13 },
    });
    expect(getPlanningArtifactCandidate(undefined, JSON.stringify(artifact), [])).toMatchObject({
      issue: { number: 13 },
    });
  });

  it("uses a timeout long enough for cold sandbox startup and the xhigh planning model", () => {
    expect(planningEvalTimeoutMs).toBeGreaterThanOrEqual(180_000);
  });

  it("uses the lightweight local sandbox backend for planning-only evals", () => {
    expect(resolveSandboxBackendName()).toBe("just-bash");
  });
});
