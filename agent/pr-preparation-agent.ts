import { createHash } from "node:crypto";

import { z } from "zod";

import { prIntentV1Schema } from "@/lib/loops/pr-intent";
import { canonicalJsonStringify } from "./lib/canonical-json";
import { screenshotArtifactUriSchema } from "./lib/screenshot-artifact-uri";

export const prPreparationAgentModelLabel = "openai/gpt-5.6-terra-xhigh";
export const prPreparationResultSchemaId = "loopworks.pr_preparation_result.v1";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const forbiddenContent =
  /(?:authorization\s*:|bearer\s+|password\s*[:=]|token\s*[:=]|secret\s*[:=]|gh[pousr]_|sk-[a-z0-9]|-----BEGIN|data:image\/|raw (?:stdout|stderr|prompt))/i;

export const prPreparationScreenshotSchema = z
  .object({
    id: identifierSchema,
    testId: identifierSchema,
    viewport: z.enum(["mobile", "laptop", "desktop"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    uri: screenshotArtifactUriSchema,
    sha256: sha256Schema,
  })
  .strict();

export const prPreparationResultSchema = z
  .object({
    version: z.literal(1),
    schemaId: z.literal(prPreparationResultSchemaId),
    model: z.literal(prPreparationAgentModelLabel),
    narrative: z
      .object({
        title: z.string().min(1).max(240),
        summary: z.string().min(1).max(2_000),
      })
      .strict(),
    binding: z
      .object({
        runId: z.string().uuid(),
        prAttempt: z.number().int().positive(),
        planId: z.string().min(1),
        planSha256: sha256Schema,
        validationReportSha256: sha256Schema,
        validationReviewResultSha256: sha256Schema,
        screenshotEvidenceSha256: sha256Schema,
        artifactSetSha256: sha256Schema,
        deploymentContextSha256: sha256Schema.optional(),
        repositoryFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        commitSha: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    intent: prIntentV1Schema,
    screenshots: z.array(prPreparationScreenshotSchema),
  })
  .strict()
  .superRefine((result, context) => {
    const serializedNarrative = JSON.stringify({
      artifacts: result.intent.artifacts,
      body: result.intent.body,
      sourceIssue: result.intent.sourceIssue,
      title: result.intent.title,
      narrative: result.narrative,
    });
    if (forbiddenContent.test(serializedNarrative)) {
      context.addIssue({
        code: "custom",
        message: "PR intent contains forbidden secret-like or raw evidence content.",
      });
    }

    const screenshotIds = new Set<string>();
    const screenshotUris = new Set<string>();
    const screenshotTargets = new Set<string>();
    for (const screenshot of result.screenshots) {
      const target = `${screenshot.testId}:${screenshot.viewport}`;
      if (screenshotIds.has(screenshot.id)) {
        context.addIssue({ code: "custom", message: `Duplicate screenshot id ${screenshot.id}.` });
      }
      if (screenshotUris.has(screenshot.uri)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate screenshot URI ${screenshot.uri}.`,
        });
      }
      if (screenshotTargets.has(target)) {
        context.addIssue({ code: "custom", message: `Duplicate screenshot target ${target}.` });
      }
      screenshotIds.add(screenshot.id);
      screenshotUris.add(screenshot.uri);
      screenshotTargets.add(target);
    }
  });

export type PrPreparationResult = z.infer<typeof prPreparationResultSchema>;

export function computePrPreparationDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}
