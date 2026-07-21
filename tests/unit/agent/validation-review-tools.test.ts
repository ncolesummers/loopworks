/** @vitest-environment node */

import { validateValidationReviewContext } from "@agent/subagents/validation-reviewer/lib/context";
import { createValidationReviewFixtureContext } from "@agent/validation-review-fixture";

type FixtureContext = ReturnType<typeof createValidationReviewFixtureContext>;

function firstValidationResult(value: FixtureContext) {
  const [result] = value.validationReport.results;
  if (!result) throw new Error("Expected fixture validation result.");
  return result;
}

describe("validation reviewer context policy", () => {
  it("accepts only a completed passing validation handoff", () => {
    const context = createValidationReviewFixtureContext();

    expect(validateValidationReviewContext(context)).toEqual(context);
  });

  it.each([
    [
      "wrong stage",
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.run.currentStage = "validation";
      },
    ],
    [
      "unfinished validation",
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.validationStep.status = "running";
      },
    ],
    [
      "failed validation",
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.validationReport.overallOutcome = "fail";
        value.validationReport.counts = { failed: 1, passed: 0, skipped: 0, total: 1 };
        firstValidationResult(value).outcome = "fail";
        firstValidationResult(value).exitCode = 1;
      },
    ],
    [
      "required skipped gate",
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.validationReport.overallOutcome = "skipped";
        value.validationReport.counts = { failed: 0, passed: 0, skipped: 1, total: 1 };
        firstValidationResult(value).outcome = "skipped";
        firstValidationResult(value).exitCode = null;
        firstValidationResult(value).skipReason = "not available";
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const context = createValidationReviewFixtureContext();
    mutate(context);

    expect(() => validateValidationReviewContext(context)).toThrow();
  });

  it("rejects stale patch, report, and screenshot digests", () => {
    for (const mutate of [
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.implementationArtifactSha256 = "0".repeat(64);
      },
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.validationArtifactSha256 = "0".repeat(64);
      },
      (value: ReturnType<typeof createValidationReviewFixtureContext>) => {
        value.screenshotArtifactSha256 = "0".repeat(64);
      },
    ]) {
      const context = createValidationReviewFixtureContext();
      mutate(context);
      expect(() => validateValidationReviewContext(context)).toThrow();
    }
  });
});
