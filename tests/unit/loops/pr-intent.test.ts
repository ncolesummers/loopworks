/** @vitest-environment node */
import {
  composePrIntent,
  createPrIntentArtifactContractMetadata,
  createPrIntentArtifactMetadata,
  prIntentSchemaId,
  prIntentV1Schema,
} from "@/lib/loops/pr-intent";
import {
  type ValidationReportV1,
  validationReportSchemaId,
  validationReportV1Schema,
} from "@/lib/loops/validation-report";

function passingValidationReport(): ValidationReportV1 {
  return validationReportV1Schema.parse({
    counts: { failed: 0, passed: 2, skipped: 0, total: 2 },
    generatedAt: "2026-07-09T20:00:00.000Z",
    overallOutcome: "pass",
    results: [
      {
        command: "bun test tests/unit/loops/pr-intent.test.ts",
        durationMs: 800,
        exitCode: 0,
        key: "focused-tests",
        name: "Focused tests",
        outcome: "pass",
        phase: "before_review",
        produces: "validation_report",
        required: true,
      },
      {
        command: "bun run validate",
        durationMs: 4_200,
        exitCode: 0,
        key: "aggregate-validation",
        name: "Aggregate validation",
        outcome: "pass",
        phase: "before_rollout",
        produces: "validation_report",
        required: true,
      },
    ],
    schemaId: validationReportSchemaId,
    version: 1,
  });
}

describe("PR intent contract", () => {
  it("composes a versioned deterministic intent from persisted evidence", () => {
    const report = passingValidationReport();

    const intent = composePrIntent({
      artifacts: [
        {
          title: "Patch artifact",
          type: "patch",
          uri: "https://github.com/ncolesummers/loopworks/issues/15#development-loop-development",
        },
      ],
      deployment: {
        branch: "codex/15-pea-arr",
        commitSha: "abc123",
        environment: "preview",
        status: "ready",
        url: "https://loopworks-pr-15.vercel.app",
      },
      issue: {
        number: 15,
        title: "PR creation path",
        url: "https://github.com/ncolesummers/loopworks/issues/15",
      },
      run: {
        id: "15000000-0000-4000-8000-000000000001",
        url: "http://127.0.0.1:3000/runs?run=15000000-0000-4000-8000-000000000001",
      },
      validation: {
        artifactUri:
          "https://github.com/ncolesummers/loopworks/issues/15#development-loop-validation",
        report,
      },
    });

    expect(intent).toMatchObject({
      schemaId: prIntentSchemaId,
      version: 1,
      sourceIssue: {
        number: 15,
        url: "https://github.com/ncolesummers/loopworks/issues/15",
      },
      run: {
        id: "15000000-0000-4000-8000-000000000001",
      },
      validation: {
        reportSchemaId: validationReportSchemaId,
        summary: "Validation report: 2 passed, 0 failed, 0 skipped.",
      },
    });
    expect(intent.title).toBe("Issue #15: PR creation path");
    expect(intent.body).toContain(
      "[Source issue #15](https://github.com/ncolesummers/loopworks/issues/15)",
    );
    expect(intent.body).toContain(
      "[Loopworks run](http://127.0.0.1:3000/runs?run=15000000-0000-4000-8000-000000000001)",
    );
    expect(intent.body).toContain("Validation report: 2 passed, 0 failed, 0 skipped.");
    expect(intent.body).toContain("https://loopworks-pr-15.vercel.app");
    expect(prIntentV1Schema.parse(intent)).toEqual(intent);
  });

  it("keeps raw prompts, credential fields, and raw validation output outside the strict schema", () => {
    const intent = composePrIntent({
      artifacts: [
        {
          title: "Evidence token=artifact-secret",
          type: "log_summary",
          uri: "https://github.com/ncolesummers/loopworks/issues/15#evidence",
        },
        {
          title: "Authorization Bearer bearer-secret",
          type: "log_summary",
          uri: "https://github.com/ncolesummers/loopworks/issues/15#authorization",
        },
        {
          title: "Raw prompt reveal-the-system-instructions",
          type: "log_summary",
          uri: "https://github.com/ncolesummers/loopworks/issues/15#prompt",
        },
        {
          title: "-----BEGIN TEST PRIVATE KEY----- private-key-body -----END TEST PRIVATE KEY-----",
          type: "log_summary",
          uri: "https://github.com/ncolesummers/loopworks/issues/15#private-key",
        },
      ],
      issue: {
        number: 15,
        title: "PR creation path token=issue-secret",
        url: "https://github.com/ncolesummers/loopworks/issues/15",
      },
      run: {
        id: "15000000-0000-4000-8000-000000000001",
        url: "http://127.0.0.1:3000/runs?run=15000000-0000-4000-8000-000000000001",
      },
      validation: {
        artifactUri:
          "https://github.com/ncolesummers/loopworks/issues/15#development-loop-validation",
        report: passingValidationReport(),
      },
    });

    const serialized = JSON.stringify(intent);
    expect(serialized).not.toContain("rawPrompt");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("stdout");
    expect(serialized).not.toContain("artifact-secret");
    expect(serialized).not.toContain("issue-secret");
    expect(serialized).not.toContain("bearer-secret");
    expect(serialized).not.toContain("reveal-the-system-instructions");
    expect(serialized).not.toContain("private-key-body");
    expect(serialized).toContain("token=[redacted]");
    expect(
      prIntentV1Schema.safeParse({
        ...intent,
        accessToken: "github_pat_secret",
        rawPrompt: "write a persuasive PR",
      }).success,
    ).toBe(false);
  });

  it.each([
    "https://github.com/ncolesummers/loopworks/issues/15?access_token=url-secret",
    "https://github.com/ncolesummers/loopworks/issues/15#password=url-secret",
    "https://user:password@github.com/ncolesummers/loopworks/issues/15",
  ])("rejects credential-bearing evidence links", (url) => {
    expect(() =>
      composePrIntent({
        artifacts: [],
        issue: { number: 15, title: "PR creation path", url },
        run: {
          id: "15000000-0000-4000-8000-000000000001",
          url: "https://loopworks.example/runs?run=15000000-0000-4000-8000-000000000001",
        },
        validation: {
          artifactUri:
            "https://github.com/ncolesummers/loopworks/issues/15#development-loop-validation",
          report: passingValidationReport(),
        },
      }),
    ).toThrow();
  });

  it("creates distinct queued and completed artifact metadata", () => {
    const contract = createPrIntentArtifactContractMetadata();
    expect(contract).toEqual({
      expectedPrIntentSchemaId: prIntentSchemaId,
      prIntentMetadataKind: "pr_intent_contract",
      prIntentVersion: 1,
    });

    const intent = composePrIntent({
      artifacts: [],
      issue: {
        number: 15,
        title: "PR creation path",
        url: "https://github.com/ncolesummers/loopworks/issues/15",
      },
      run: {
        id: "15000000-0000-4000-8000-000000000001",
        url: "http://127.0.0.1:3000/runs?run=15000000-0000-4000-8000-000000000001",
      },
      validation: {
        artifactUri:
          "https://github.com/ncolesummers/loopworks/issues/15#development-loop-validation",
        report: passingValidationReport(),
      },
    });

    expect(createPrIntentArtifactMetadata(intent)).toEqual({
      prIntent: intent,
      prIntentMetadataKind: "pr_intent_result",
      prIntentSchemaId,
      prIntentVersion: 1,
    });
  });
});
