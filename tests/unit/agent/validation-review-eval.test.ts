/** @vitest-environment node */
import {
  parseValidationReviewSubagentOutput,
  readValidationReviewFixture,
  resolveValidationReviewFixturePath,
  validationReviewEvalTimeoutMs,
} from "../../../evals/validation-review/issue-49-review.eval";

describe("validation review Eve eval fixture", () => {
  it("discovers the pinned issue #49 fixture without a live model call", async () => {
    expect(
      resolveValidationReviewFixturePath().endsWith(
        "evals/validation-review/fixtures/issue-49.json",
      ),
    ).toBe(true);
    await expect(readValidationReviewFixture()).resolves.toMatchObject({
      issueNumber: 49,
      repositoryFullName: "ncolesummers/loopworks",
      acceptanceCriteria: expect.arrayContaining([
        expect.stringContaining("deterministic results"),
        expect.stringContaining("root orchestrator"),
      ]),
    });
    expect(validationReviewEvalTimeoutMs).toBeGreaterThanOrEqual(180_000);
  });

  it("decodes the serialized subagent output", () => {
    const result = { schemaId: "loopworks.validation_review_result.v1", version: 1 };

    expect(parseValidationReviewSubagentOutput(JSON.stringify(result))).toEqual(result);
    expect(parseValidationReviewSubagentOutput("not json")).toBeUndefined();
  });
});
