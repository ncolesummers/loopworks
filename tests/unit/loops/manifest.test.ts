import { defaultLoopManifest, parseLoopManifest, validateLoopManifest } from "@/lib/loops/manifest";
import { loopManifestSchema, retryableStatusValues } from "../../../schemas/loop-manifest";
import loopManifestJsonSchema from "../../../schemas/loop-manifest.schema.json";

type JsonSchemaObject = {
  required?: string[];
  properties?: Record<string, JsonSchemaObject>;
  $defs?: Record<string, JsonSchemaObject>;
};

describe("loop manifest schema", () => {
  it("parses the default manifest", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    expect(manifest.version).toBe(1);
    expect(manifest.repo).toBe("ncolesummers/loopworks");
    expect(manifest.loopStates).toContain("planned");
    expect(manifest.agentReady.readyLabels).toContain("status:ready");
    expect(manifest.loops[0]).toMatchObject({
      key: "development-loop",
      enabled: true,
      repoScope: {
        repositories: ["ncolesummers/loopworks"],
      },
      triggers: {
        issueLabels: expect.arrayContaining(["agent-ready"]),
        manual: true,
        schedule: {
          enabled: false,
        },
      },
    });
  });

  it("accepts enabled and disabled loop definitions", () => {
    const manifest = parseLoopManifest({
      ...defaultLoopManifest,
      loops: [
        defaultLoopManifest.loops[0],
        {
          ...defaultLoopManifest.loops[0],
          key: "security-review-loop",
          name: "Security review loop",
          enabled: false,
        },
      ],
    });

    expect(manifest.loops.map((loop) => loop.enabled)).toEqual([true, false]);
  });

  it("declares an enabled read-only research loop with distinct trigger and concurrency policy", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);
    const researchLoop = manifest.loops.find((loop) => loop.key === "research-loop");

    expect(researchLoop).toMatchObject({
      enabled: true,
      triggers: {
        issueLabels: ["agent-ready", "spike"],
      },
      toolPolicy: {
        allowedToolCategories: ["repo-read", "browser", "validation"],
        externalWritesRequireApproval: true,
      },
      approvals: {
        requiredFor: ["manifest_rollout"],
      },
      concurrency: {
        group: "repo:{repo}:loop:research",
      },
      githubWriteback: {
        enabled: false,
        channels: [],
      },
    });
    expect(researchLoop?.artifacts.map((artifact) => artifact.description)).toEqual([
      expect.stringContaining("research plan"),
      expect.stringContaining("findings"),
      expect.stringContaining("research document"),
      expect.stringContaining("completion summary"),
    ]);
    expect(researchLoop?.validationGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "bun run test -- tests/unit/loops/research-run.test.ts",
          key: "focused-research-tests",
        }),
        expect.objectContaining({ command: "bun run validate", key: "aggregate-validation" }),
      ]),
    );
  });

  it("covers trigger labels, validation gates, approvals, retries, and concurrency", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);
    const developmentLoop = manifest.loops[0];

    expect(developmentLoop.triggers.issueLabels).toEqual(expect.arrayContaining(["agent-ready"]));
    expect(developmentLoop.validationGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "focused-tests",
          command: "bun test tests/unit/loops/manifest.test.ts",
          required: true,
        }),
        expect.objectContaining({
          key: "aggregate-validation",
          command: "bun run validate",
          required: true,
        }),
      ]),
    );
    expect(developmentLoop.approvals.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "plan-review",
          required: true,
        }),
        expect.objectContaining({
          key: "external-write-review",
          required: true,
        }),
      ]),
    );
    expect(developmentLoop.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "test_plan", required: true }),
        expect.objectContaining({ type: "pr_intent", required: true }),
      ]),
    );
    expect(developmentLoop.retryPolicy).toMatchObject({
      maxAttempts: 2,
      retryableStatuses: [...retryableStatusValues],
      backoff: {
        strategy: "exponential",
      },
    });
    expect(developmentLoop.concurrency).toMatchObject({
      group: "repo:{repo}:loop:development",
      maxInFlight: 1,
    });
    expect(developmentLoop.reconciliation).toEqual({
      silenceThresholdSeconds: 300,
    });
  });

  it("requires a positive reconciliation silence threshold for every loop", () => {
    const developmentLoop = defaultLoopManifest.loops[0];
    const withoutReconciliation = { ...developmentLoop } as Record<string, unknown>;
    delete withoutReconciliation.reconciliation;

    const missing = validateLoopManifest({
      ...defaultLoopManifest,
      loops: [withoutReconciliation],
    });
    const zero = validateLoopManifest({
      ...defaultLoopManifest,
      loops: [
        {
          ...developmentLoop,
          reconciliation: { silenceThresholdSeconds: 0 },
        },
      ],
    });
    const fractional = validateLoopManifest({
      ...defaultLoopManifest,
      loops: [
        {
          ...developmentLoop,
          reconciliation: { silenceThresholdSeconds: 0.5 },
        },
      ],
    });

    for (const result of [missing, zero, fractional]) {
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Expected reconciliation validation to fail.");
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining("reconciliation"),
            hint: expect.stringContaining("silence threshold"),
          }),
        ]),
      );
    }
  });

  it("returns actionable validation errors with paths and hints", () => {
    const result = validateLoopManifest({
      ...defaultLoopManifest,
      repo: "not a slug",
      loops: [
        {
          ...defaultLoopManifest.loops[0],
          triggers: {
            ...defaultLoopManifest.loops[0].triggers,
            issueLabels: [],
          },
          validationGates: [],
          retryPolicy: {
            ...defaultLoopManifest.loops[0].retryPolicy,
            maxAttempts: 0,
          },
          concurrency: {
            ...defaultLoopManifest.loops[0].concurrency,
            maxInFlight: 0,
          },
          approvals: {
            ...defaultLoopManifest.loops[0].approvals,
            gates: [
              {
                ...defaultLoopManifest.loops[0].approvals.gates[0],
                required: false,
              },
            ],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected manifest validation to fail.");
    }

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "repo",
          message: expect.stringContaining("owner/repo"),
          hint: expect.stringContaining("owner/repo"),
        }),
        expect.objectContaining({
          path: "loops[0].triggers.issueLabels",
          hint: expect.stringContaining("label"),
        }),
        expect.objectContaining({
          path: "loops[0].validationGates",
          hint: expect.stringContaining("validation"),
        }),
        expect.objectContaining({
          path: "loops[0].retryPolicy.maxAttempts",
          hint: expect.stringContaining("retry"),
        }),
        expect.objectContaining({
          path: "loops[0].concurrency.maxInFlight",
          hint: expect.stringContaining("concurrency"),
        }),
        expect.objectContaining({
          path: "loops[0].approvals.gates[0].required",
          hint: expect.stringContaining("approval"),
        }),
      ]),
    );
  });

  it("keeps JSON schema required fields aligned with Zod defaults", () => {
    const jsonSchema = loopManifestJsonSchema as JsonSchemaObject;
    const definitions = jsonSchema.$defs ?? {};

    expect(jsonSchema.required).toEqual([
      "version",
      "repo",
      "note",
      "loops",
      "milestones",
      "labels",
    ]);
    expect(jsonSchema.required).not.toContain("loopStates");
    expect(jsonSchema.required).not.toContain("requiredMetadata");
    expect(jsonSchema.required).not.toContain("agentReady");
    expect(definitions.modelPolicy?.required).toEqual(["defaultModel"]);
    expect(definitions.toolPolicy?.properties).not.toHaveProperty("forbiddenToolCategories");
    expect(definitions.approvalGate?.properties?.required).toEqual({ const: true });
    expect(definitions.loopDefinition?.required).toContain("reconciliation");
    expect(definitions.reconciliation?.required).toEqual(["silenceThresholdSeconds"]);
  });

  it("maps each MVP milestone and issue to persona-derived acceptance ids", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    for (const milestone of manifest.milestones) {
      expect(milestone.personaTestIds, milestone.name).toEqual(
        expect.arrayContaining([expect.stringMatching(/^[PMARS]\d{2}$/)]),
      );

      for (const issue of milestone.issues) {
        expect(issue.personaTestIds, `${milestone.name} / ${issue.title}`).toEqual(
          expect.arrayContaining([expect.stringMatching(/^[PMARS]\d{2}$/)]),
        );
      }
    }
  });

  it("keeps milestone persona ids as supersets of their issue persona ids", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    for (const milestone of manifest.milestones) {
      const milestoneIds = new Set(milestone.personaTestIds);

      for (const issue of milestone.issues) {
        expect(
          issue.personaTestIds.every((personaTestId) => milestoneIds.has(personaTestId)),
          `${milestone.name} must include all persona ids from ${issue.title}`,
        ).toBe(true);
      }
    }
  });

  it("rejects an invalid repo slug", () => {
    const result = loopManifestSchema.safeParse({
      ...defaultLoopManifest,
      repo: "not a slug",
    });

    expect(result.success).toBe(false);
  });
});
