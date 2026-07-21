/** @vitest-environment node */

import {
  createPrPreparationResultFromContext,
  validatePrPreparationContext,
} from "@agent/subagents/pr-preparer/lib/context";
import { createPrPreparationFixtureContext } from "@agent/pr-preparation-fixture";
import { computePrPreparationDigest } from "@agent/pr-preparation-agent";

describe("PR preparation context policy", () => {
  it("accepts the exact post-review and post-commit handoff", () => {
    const context = createPrPreparationFixtureContext();

    expect(validatePrPreparationContext(context)).toEqual(context);
    const result = createPrPreparationResultFromContext(context, {
      title: "Issue #50: PR preparation subagent",
      summary: "Prepare typed PR intent without granting GitHub mutation authority.",
    });
    expect(result.intent.body).toContain("Source issue #50");
    expect(result.intent.body).toContain("Validation report: 1 passed, 0 failed, 0 skipped.");
    expect(result.intent.body).toContain("Code review notes");
    expect(result.intent.body).toContain("artifact://screenshots/browser-ac-1-mobile.png");
    expect(result.screenshots).toEqual(
      context.screenshotEvidence.captures.map(
        ({ id, testId, viewport, width, height, uri, sha256 }) => ({
          id,
          testId,
          viewport,
          width,
          height,
          uri,
          sha256,
        }),
      ),
    );
  });

  it.each([
    [
      "wrong stage",
      (value: ReturnType<typeof createPrPreparationFixtureContext>) => {
        value.run.currentStage = "commit";
      },
    ],
    [
      "unfinished commit",
      (value: ReturnType<typeof createPrPreparationFixtureContext>) => {
        value.commitStep.status = "running";
      },
    ],
    [
      "non-commit review route",
      (value: ReturnType<typeof createPrPreparationFixtureContext>) => {
        value.validationReviewResult.recommendation.route = "development";
        value.validationReviewResult.recommendation.findingIds = ["implementation-defect"];
      },
    ],
    [
      "stale screenshot evidence",
      (value: ReturnType<typeof createPrPreparationFixtureContext>) => {
        value.screenshotArtifactSha256 = "0".repeat(64);
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const context = createPrPreparationFixtureContext();
    mutate(context);

    expect(() => validatePrPreparationContext(context)).toThrow();
  });

  it("renders an explicit no-deployment state and an empty screenshot list for non-UI runs", () => {
    const context = createPrPreparationFixtureContext({ deployment: null, uiAffecting: false });

    const result = createPrPreparationResultFromContext(context, {
      title: "Issue #50: PR preparation subagent",
      summary: "Prepare the bounded PR intent.",
    });
    expect(result.intent.deployment).toBeUndefined();
    expect(result.intent.body).toContain("No deployment context was recorded");
    expect(result.screenshots).toEqual([]);
  });

  it("keeps earlier red validation evidence alongside the final validation report", () => {
    const context = createPrPreparationFixtureContext();
    const finalValidationUri = context.completedArtifacts.find(
      (artifact) => artifact.sha256 === context.validationArtifactSha256,
    )?.uri;
    context.completedArtifacts.push({
      title: "Red test evidence",
      type: "validation_report",
      uri: "https://github.com/ncolesummers/loopworks/issues/50#red-evidence",
      sha256: "9".repeat(64),
    });
    context.completedArtifacts.sort((left, right) => left.title.localeCompare(right.title));
    context.artifactSetSha256 = computePrPreparationDigest(context.completedArtifacts);

    expect(validatePrPreparationContext(context)).toEqual(context);
    const result = createPrPreparationResultFromContext(context, {
      title: "Issue #50: PR preparation subagent",
      summary: "Prepare the bounded PR intent.",
    });
    expect(result.intent.validation.artifactUri).toBe(finalValidationUri);
  });

  it("rejects credential-bearing evidence before it can reach a reader tool", () => {
    const artifactContext = createPrPreparationFixtureContext();
    artifactContext.completedArtifacts[0] = {
      ...artifactContext.completedArtifacts[0],
      uri: "https://example.com/evidence?access_token=secret",
    };
    artifactContext.artifactSetSha256 = computePrPreparationDigest(
      artifactContext.completedArtifacts,
    );
    expect(() => validatePrPreparationContext(artifactContext)).toThrow(
      "Evidence links must use HTTP(S) without credentials or sensitive query data.",
    );

    const deploymentContext = createPrPreparationFixtureContext();
    if (!deploymentContext.deployment) throw new Error("Expected fixture deployment.");
    deploymentContext.deployment.url = "https://example.com/?api_key=secret";
    deploymentContext.deploymentContextSha256 = computePrPreparationDigest(
      deploymentContext.deployment,
    );
    expect(() => validatePrPreparationContext(deploymentContext)).toThrow(
      "Evidence links must use HTTP(S) without credentials or sensitive query data.",
    );
  });
});
