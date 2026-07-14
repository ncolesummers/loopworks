/** @vitest-environment node */
import {
  computeValidationReviewDigest,
  type ValidationReviewResult,
  validationReviewAgentModelLabel,
  validationReviewResultSchema,
  validationReviewResultSchemaId,
} from "@agent/validation-review-agent";

function validResult(): ValidationReviewResult {
  return {
    version: 1 as const,
    schemaId: validationReviewResultSchemaId,
    model: validationReviewAgentModelLabel,
    binding: {
      runId: "00000000-0000-4000-8000-000000000049",
      reviewAttempt: 1,
      planId: "plan-49",
      planSha256: "a".repeat(64),
      testPlanSha256: "b".repeat(64),
      implementationResultSha256: "c".repeat(64),
      productionPatchSha256: "d".repeat(64),
      validationReportSha256: "e".repeat(64),
      screenshotEvidenceSha256: "f".repeat(64),
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "1".repeat(40),
    },
    evidence: {
      validationResults: [
        {
          key: "aggregate-validation",
          command: "bun run validate",
          outcome: "pass" as const,
          outputSha256: "2".repeat(64),
        },
      ],
      screenshots: [
        {
          id: "browser-ac-1-mobile",
          testId: "browser-ac-1",
          viewport: "mobile" as const,
          width: 390,
          height: 844,
          uri: "artifact://screenshots/browser-ac-1-mobile.png",
          sha256: "3".repeat(64),
        },
      ],
    },
    findings: [
      {
        id: "finding-1",
        severity: "medium" as const,
        category: "responsive" as const,
        summary: "The narrow layout needs another implementation pass.",
        path: "src/components/example.tsx",
        line: 42,
        validationCitationKeys: ["aggregate-validation"],
        screenshotCitationIds: ["browser-ac-1-mobile"],
      },
    ],
    recommendation: {
      route: "development" as const,
      reason: "Responsive evidence shows an implementation defect.",
      findingIds: ["finding-1"],
      validationCitationKeys: ["aggregate-validation"],
      screenshotCitationIds: ["browser-ac-1-mobile"],
    },
  };
}

function firstFinding(result: ValidationReviewResult) {
  const [finding] = result.findings;
  if (!finding) throw new Error("Expected fixture finding.");
  return finding;
}

function firstScreenshot(result: ValidationReviewResult) {
  const [screenshot] = result.evidence.screenshots;
  if (!screenshot) throw new Error("Expected fixture screenshot.");
  return screenshot;
}

describe("validation review result contract", () => {
  it("accepts digest-bound findings with exact validation and screenshot citations", () => {
    const result = validResult();

    expect(validationReviewResultSchema.parse(result)).toEqual(result);
    expect(computeValidationReviewDigest(result)).toMatch(/^[a-f0-9]{64}$/);
    expect(result.model).toBe("openai/gpt-5.6-terra-xhigh");
  });

  it("rejects unknown, missing, or duplicate evidence citations", () => {
    const unknown = validResult();
    firstFinding(unknown).validationCitationKeys = ["missing-gate"];
    expect(validationReviewResultSchema.safeParse(unknown).success).toBe(false);

    const missingScreenshot = validResult();
    firstFinding(missingScreenshot).screenshotCitationIds = [];
    expect(validationReviewResultSchema.safeParse(missingScreenshot).success).toBe(false);

    const duplicate = validResult();
    duplicate.evidence.screenshots.push({ ...firstScreenshot(duplicate) });
    expect(validationReviewResultSchema.safeParse(duplicate).success).toBe(false);

    const duplicateCitation = validResult();
    firstFinding(duplicateCitation).validationCitationKeys.push("aggregate-validation");
    expect(validationReviewResultSchema.safeParse(duplicateCitation).success).toBe(false);
  });

  it("rejects unsafe routing, paths, and secret-like narrative", () => {
    const blocker = validResult();
    firstFinding(blocker).severity = "blocker";
    blocker.recommendation.route = "commit";
    expect(validationReviewResultSchema.safeParse(blocker).success).toBe(false);

    const noFinding = validResult();
    noFinding.findings = [];
    noFinding.recommendation.findingIds = [];
    expect(validationReviewResultSchema.safeParse(noFinding).success).toBe(false);

    const traversal = validResult();
    firstFinding(traversal).path = "../private.env";
    expect(validationReviewResultSchema.safeParse(traversal).success).toBe(false);

    const unsafeScreenshotUri = validResult();
    firstScreenshot(unsafeScreenshotUri).uri = "https://user:password@example.com/capture.png";
    expect(validationReviewResultSchema.safeParse(unsafeScreenshotUri).success).toBe(false);

    const secret = validResult();
    secret.recommendation.reason = "authorization: Bearer top-secret";
    expect(validationReviewResultSchema.safeParse(secret).success).toBe(false);
  });
});
