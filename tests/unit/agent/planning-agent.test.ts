/** @vitest-environment node */
import {
  createPlanningAgentSeedPlan,
  pinnedPlanningAgentOutputSchema,
  planningAgentModelLabel,
  planningAgentOutputSchema,
} from "@agent/planning-agent";

const issue13Input = {
  repositoryFullName: "ncolesummers/loopworks",
  issueNumber: 13,
  issueUrl: "https://github.com/ncolesummers/loopworks/issues/13",
  title: "Initial Eve planning agent",
  body: [
    "## Acceptance Criteria",
    "- Agent output is an executable plan artifact with stages, validation gates, approval points, and risks.",
    "- Agent tools are narrow and auditable.",
    "- Future model/prompt/tool changes have a path to eval coverage.",
  ].join("\n"),
  labels: ["loop:development", "area:agents", "priority:p1"],
  milestone: null,
  repositoryRevision: {
    ref: "main",
    commitSha: "a".repeat(40),
  },
};

describe("Planning agent artifact contract", () => {
  it("builds the issue #13 executable planning artifact shape", () => {
    const plan = createPlanningAgentSeedPlan(issue13Input);

    expect(planningAgentOutputSchema.parse(plan)).toEqual(plan);
    expect(plan.model).toBe(planningAgentModelLabel);
    expect(plan.model).toBe("openai/gpt-5.6-sol-xhigh");
    expect(plan.issue).toMatchObject({
      number: 13,
      repositoryFullName: "ncolesummers/loopworks",
      title: "Initial Eve planning agent",
      url: "https://github.com/ncolesummers/loopworks/issues/13",
    });
    expect(plan.issue.acceptanceCriteria).toEqual([
      "Agent output is an executable plan artifact with stages, validation gates, approval points, and risks.",
      "Agent tools are narrow and auditable.",
      "Future model/prompt/tool changes have a path to eval coverage.",
    ]);
    expect(plan.identity).toMatchObject({
      id: "plan:ncolesummers/loopworks#13",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(plan.repositoryRevision).toEqual({
      ref: "main",
      commitSha: "a".repeat(40),
    });
    expect(plan.stages.map((stage) => stage.key)).toEqual([
      "resolve-issue",
      "plan-artifact",
      "validation-scope",
      "approval-review",
      "handoff",
    ]);
    expect(plan.validationGates.map((gate) => gate.key)).toEqual(
      expect.arrayContaining(["focused-agent-tests", "eve-eval-discovery", "aggregate-validate"]),
    );
    expect(plan.approvalPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "maintainer-review",
          required: true,
        }),
      ]),
    );
    expect(plan.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "unsafe-tool-mutation",
          severity: "high",
        }),
      ]),
    );
  });

  it("rejects an emitted planning artifact that has no inspected repository pin", () => {
    const plan = createPlanningAgentSeedPlan({ ...issue13Input, repositoryRevision: null });

    expect(planningAgentOutputSchema.safeParse(plan).success).toBe(true);
    expect(pinnedPlanningAgentOutputSchema.safeParse(plan).success).toBe(false);
  });

  it("documents the planning-only tool contract and fixture/eval coverage", () => {
    const plan = createPlanningAgentSeedPlan(issue13Input);

    expect(plan.toolContractSummary).toMatchObject({
      planningOnly: true,
      planArtifactOnlyWrite: true,
    });
    expect(plan.toolContractSummary.allowedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "bash",
          mutates: false,
          capability: expect.stringContaining("read-only"),
        }),
        expect.objectContaining({
          name: "emit_plan_artifact",
          mutates: true,
          capability: expect.stringContaining("plan artifact"),
        }),
        expect.objectContaining({ name: "prepare_repository_context", mutates: false }),
        expect.objectContaining({ name: "list_repository_files", mutates: false }),
        expect.objectContaining({ name: "search_repository", mutates: false }),
        expect.objectContaining({ name: "read_repository_files", mutates: false }),
      ]),
    );
    expect(plan.fixtureMode).toMatchObject({
      activationEnv: "LOOPWORKS_EVE_FIXTURE_MODE",
      productionPolicy: "fail-closed",
    });
    expect(plan.evalCoverage).toContainEqual(
      expect.objectContaining({
        command: "bunx eve eval planning --skip-report --timeout 180000",
        mechanism: "eve-eval",
      }),
    );
  });
});
