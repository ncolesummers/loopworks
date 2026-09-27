/** @vitest-environment node */
import { computePlanningArtifactDigest, createPlanningAgentSeedPlan } from "@agent/planning-agent";
import { projectApprovalPlan } from "@/lib/portal/approval-plan";

function planFixture() {
  const plan = createPlanningAgentSeedPlan({
    repositoryFullName: "ncolesummers/loopworks",
    issueNumber: 275,
    title: "Review approval plans",
    body: "## Acceptance Criteria\n- Evidence remains available",
    labels: [],
    milestone: null,
    repositoryRevision: { ref: "main", commitSha: "b".repeat(40) },
  });
  return plan;
}
function project(content: unknown, overrides = {}) {
  const plan = planFixture();
  return projectApprovalPlan({
    content,
    planId: "27500000-0000-4000-8000-000000000003",
    planSha256: plan.identity.sha256,
    runId: "run-275",
    ...overrides,
  });
}

describe("approval plan projection", () => {
  it("presents the existing typed plan and retains original unknown raw evidence", () => {
    const plan = planFixture();
    const raw = { ...plan, additionalEvidence: { text: "<script>plain evidence</script>" } };
    const result = project(raw);
    expect(result.reviewability).toBe("ready");
    expect(result.canReject).toBe(true);
    expect(result.review).toEqual(plan);
    expect(JSON.parse(result.content ?? "null")).toEqual(raw);
  });
  it.each([null, undefined])("makes missing content explicit: %s", (content) => {
    expect(project(content)).toMatchObject({
      reviewability: "missing",
      canReject: true,
      reason: expect.any(String),
    });
  });
  it.each([42, "not a plan", [], { summary: "Incomplete" }, { ...planFixture(), steps: [] }])(
    "identifies malformed content without fabricating a review",
    (content) => {
      const result = project(content);
      expect(result).toMatchObject({ reviewability: "malformed", reason: expect.any(String) });
      expect(result.review).toBeUndefined();
      expect(JSON.parse(result.content ?? "null")).toEqual(content);
    },
  );
  it("identifies a known unsupported model contract", () => {
    expect(project({ ...planFixture(), model: "future-planner" })).toMatchObject({
      reviewability: "unsupported",
    });
  });
  it("identifies an incompatible host tool contract", () => {
    const plan = planFixture();
    expect(
      project({
        ...plan,
        toolContractSummary: { ...plan.toolContractSummary, planningOnly: false },
      }),
    ).toMatchObject({ reviewability: "unsupported" });
  });
  it.each([{ planId: undefined }, { planId: "" }, { planSha256: undefined }, { runId: null }])(
    "requires bound identity and run: %j",
    (overrides) => {
      expect(project(planFixture(), overrides).reviewability).toBe("unbound");
    },
  );
  it("retains content and permits rejection only with a run and plan id", () => {
    expect(project(planFixture(), { planSha256: undefined })).toMatchObject({
      reviewability: "unbound",
      canReject: true,
    });
    expect(project(planFixture(), { planId: undefined })).toMatchObject({
      reviewability: "unbound",
      canReject: false,
      content: expect.any(String),
    });
    expect(project(planFixture(), { runId: null }).canReject).toBe(false);
  });
  it.each([{ planSha256: "c".repeat(64) }])("detects metadata mismatch: %j", (overrides) => {
    expect(project(planFixture(), overrides).reviewability).toBe("mismatch");
  });
  it("preserves distinct database row and internal artifact identities", () => {
    expect(
      project(planFixture(), { planId: "27500000-0000-4000-8000-000000000003" }),
    ).toMatchObject({
      id: "27500000-0000-4000-8000-000000000003",
      reviewability: "ready",
      review: { identity: { id: planFixture().identity.id } },
    });
  });
  it("detects a changed plan whose metadata and embedded digest still match", () => {
    expect(project({ ...planFixture(), summary: "Changed after digest" }).reviewability).toBe(
      "mismatch",
    );
  });
  it("reports a missing pinned revision without claiming approval can advance", () => {
    const plan = { ...planFixture(), repositoryRevision: null };
    plan.identity.sha256 = computePlanningArtifactDigest(plan);
    expect(project(plan, { planSha256: plan.identity.sha256 })).toMatchObject({
      reviewability: "unpinned",
    });
  });
});

it.each(["not-a-uuid", planFixture().identity.id, "27500000-0000-4000-8000-00000000000z"])(
  "blocks decisions for an invalid database plan identifier: %s",
  (planId) => {
    const result = project(planFixture(), { planId });
    expect(result).toMatchObject({ id: planId, reviewability: "unbound", canReject: false });
    expect(result.review).toBeUndefined();
    expect(JSON.parse(result.content ?? "null")).toEqual(planFixture());
  },
);
