/** @vitest-environment node */

import {
  computePrPreparationDigest,
  prPreparationAgentModelLabel,
  prPreparationResultSchema,
  prPreparationResultSchemaId,
} from "@agent/pr-preparation-agent";

function validResult() {
  return {
    version: 1 as const,
    schemaId: prPreparationResultSchemaId,
    model: prPreparationAgentModelLabel,
    narrative: {
      title: "Issue #50: PR preparation subagent",
      summary: "Prepare a bounded PR intent.",
    },
    binding: {
      runId: "00000000-0000-4000-8000-000000000050",
      prAttempt: 1,
      planId: "00000000-0000-4000-8000-000000000150",
      planSha256: "a".repeat(64),
      validationReportSha256: "b".repeat(64),
      validationReviewResultSha256: "c".repeat(64),
      screenshotEvidenceSha256: "d".repeat(64),
      artifactSetSha256: "e".repeat(64),
      deploymentContextSha256: "f".repeat(64),
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "1".repeat(40),
    },
    intent: {
      version: 1 as const,
      schemaId: "loopworks.pr_intent.v1" as const,
      title: "Issue #50: PR preparation subagent",
      body: "## Summary\n\nPrepare a bounded PR intent.",
      sourceIssue: {
        number: 50,
        title: "PR preparation subagent",
        url: "https://github.com/ncolesummers/loopworks/issues/50",
      },
      run: {
        id: "00000000-0000-4000-8000-000000000050",
        url: "https://loopworks.example/runs?run=00000000-0000-4000-8000-000000000050",
      },
      validation: {
        artifactUri: "https://github.com/ncolesummers/loopworks/issues/50#validation",
        reportSchemaId: "loopworks.validation_report.v1" as const,
        summary: "Validation report: 1 passed, 0 failed, 0 skipped.",
      },
      deployment: {
        environment: "preview",
        status: "ready",
        url: "https://loopworks-pr-50.vercel.app",
      },
      artifacts: [
        {
          title: "Code review notes",
          type: "log_summary",
          uri: "https://github.com/ncolesummers/loopworks/issues/50#review",
        },
      ],
    },
    screenshots: [
      {
        id: "browser-ac-1-mobile",
        testId: "browser-ac-1",
        viewport: "mobile" as const,
        width: 390,
        height: 844,
        uri: "artifact://screenshots/browser-ac-1-mobile.png",
        sha256: "2".repeat(64),
      },
      {
        id: "browser-ac-1-laptop",
        testId: "browser-ac-1",
        viewport: "laptop" as const,
        width: 1280,
        height: 832,
        uri: "artifact://screenshots/browser-ac-1-laptop.png",
        sha256: "3".repeat(64),
      },
      {
        id: "browser-ac-1-desktop",
        testId: "browser-ac-1",
        viewport: "desktop" as const,
        width: 1440,
        height: 960,
        uri: "artifact://screenshots/browser-ac-1-desktop.png",
        sha256: "4".repeat(64),
      },
    ],
  };
}

describe("PR preparation result contract", () => {
  it("accepts a typed intent with exact responsive screenshot references", () => {
    const result = validResult();

    expect(prPreparationResultSchema.parse(result)).toEqual(result);
    expect(computePrPreparationDigest(result)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate, unsafe, or secret-bearing screenshot and narrative content", () => {
    const duplicate = validResult();
    const [firstScreenshot] = duplicate.screenshots;
    if (!firstScreenshot) throw new Error("Expected a fixture screenshot.");
    duplicate.screenshots.push({ ...firstScreenshot });
    expect(prPreparationResultSchema.safeParse(duplicate).success).toBe(false);

    const unsafe = validResult();
    const [unsafeScreenshot] = unsafe.screenshots;
    if (!unsafeScreenshot) throw new Error("Expected a fixture screenshot.");
    unsafeScreenshot.uri = "artifact://screenshots/../secret.png";
    expect(prPreparationResultSchema.safeParse(unsafe).success).toBe(false);

    const secret = validResult();
    secret.intent.body = "Authorization: Bearer ghp_secret";
    expect(prPreparationResultSchema.safeParse(secret).success).toBe(false);
  });
});
