import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJsonStringify } from "./lib/canonical-json";

export const implementationAgentModelLabel = "openai/gpt-5.6-terra-xhigh";
export const implementationResultSchemaId = "loopworks.implementation_result.v1";
export const maxImplementationPatchBytes = 512 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

export function computeImplementationDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

const forbiddenProductionSegments = new Set([
  ".git",
  ".loopworks",
  "node_modules",
  "test",
  "tests",
  "eval",
  "evals",
  "fixture",
  "fixtures",
  "story",
  "stories",
  ".github",
  ".circleci",
]);

const forbiddenProductionFilePattern =
  /^(?:package\.json|bun\.lockb?|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|AGENTS\.md|CLAUDE\.md|\.env(?:\..*)?)$/i;

export function isAllowedProductionArtifactPath(path: string): boolean {
  const normalized = path.trim().replaceAll("\\", "/");
  const segments = normalized.split("/");
  const filename = segments.at(-1) ?? "";
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.includes("//") &&
    !/[;&|`$<>\n\r\0]/.test(normalized) &&
    !segments.some((segment) => segment === "." || segment === "..") &&
    !segments.some((segment) => forbiddenProductionSegments.has(segment.toLowerCase())) &&
    !forbiddenProductionFilePattern.test(filename) &&
    !/\.(?:test|spec|stories)\.[^/]+$/i.test(filename) &&
    !/(?:^|[-_.])fixture(?:[-_.]|$)/i.test(filename)
  );
}

function patchHeaderPaths(content: string): string[] {
  const paths = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      if (diffMatch[1]) paths.add(diffMatch[1]);
      if (diffMatch[2]) paths.add(diffMatch[2]);
      continue;
    }
    const headerMatch = line.match(/^(?:---|\+\+\+) (?:[ab]\/(.+)|\/dev\/null)$/);
    if (headerMatch?.[1]) paths.add(headerMatch[1]);
  }
  return [...paths];
}

const outputReferenceSchema = z
  .object({
    uri: z.string().min(1),
    sha256: sha256Schema,
    byteCount: z.number().int().nonnegative(),
    redacted: z.literal(true),
  })
  .strict();

const greenEvidenceSchema = z
  .object({
    id: identifierSchema,
    testId: identifierSchema,
    acceptanceCriterionIds: z.array(identifierSchema).min(1),
    command: z.string().min(1),
    testPath: z.string().min(1),
    outcome: z.literal("pass"),
    exitCode: z.literal(0),
    durationMs: z.number().int().nonnegative(),
    executionReceipt: sha256Schema,
    outputReference: outputReferenceSchema,
  })
  .strict();

export const implementationResultSchema = z
  .object({
    version: z.literal(1),
    schemaId: z.literal(implementationResultSchemaId),
    model: z.literal(implementationAgentModelLabel),
    binding: z
      .object({
        planId: z.string().min(1),
        planSha256: sha256Schema,
        testPlanSha256: sha256Schema,
        testPatchSha256: sha256Schema,
        fixturesSha256: sha256Schema,
        repositoryFullName: z.string().min(1),
        commitSha: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    patch: z
      .object({
        format: z.literal("unified-diff"),
        content: z.string().min(1),
        sha256: sha256Schema,
        byteCount: z.number().int().positive().max(maxImplementationPatchBytes),
        paths: z.array(z.string().refine(isAllowedProductionArtifactPath)).min(1),
      })
      .strict(),
    greenEvidence: z.array(greenEvidenceSchema).min(1),
    validationEvidence: z
      .object({
        command: z.literal("bun run validate"),
        outcome: z.literal("pass"),
        exitCode: z.literal(0),
        durationMs: z.number().int().nonnegative(),
        executionReceipt: sha256Schema,
        outputReference: outputReferenceSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((result, ctx) => {
    for (const [label, values] of [
      ["evidence", result.greenEvidence.map(({ id }) => id)],
      ["test", result.greenEvidence.map(({ testId }) => testId)],
    ] as const) {
      const duplicate = values.find((value, index) => values.indexOf(value) !== index);
      if (duplicate) ctx.addIssue({ code: "custom", message: `Duplicate ${label} ${duplicate}.` });
    }

    const parsedPaths = patchHeaderPaths(result.patch.content);
    const declaredPaths = new Set(result.patch.paths);
    if (parsedPaths.length === 0) {
      ctx.addIssue({ code: "custom", message: "Patch must contain parseable diff headers." });
    }
    if (
      /^(?:rename|copy) (?:from|to) |^GIT binary patch$|^(?:new file mode|old mode|new mode) 120000$/m.test(
        result.patch.content,
      )
    ) {
      ctx.addIssue({ code: "custom", message: "Patch contains a forbidden operation." });
    }
    for (const path of parsedPaths) {
      if (!declaredPaths.has(path) || !isAllowedProductionArtifactPath(path)) {
        ctx.addIssue({ code: "custom", message: `Patch contains unsafe path ${path}.` });
      }
    }
    for (const path of declaredPaths) {
      if (!parsedPaths.includes(path)) {
        ctx.addIssue({ code: "custom", message: `Declared path ${path} is absent from patch.` });
      }
    }
    if (Buffer.byteLength(result.patch.content) !== result.patch.byteCount) {
      ctx.addIssue({ code: "custom", message: "Patch byte count does not match content." });
    }
    if (createHash("sha256").update(result.patch.content).digest("hex") !== result.patch.sha256) {
      ctx.addIssue({ code: "custom", message: "Patch digest does not match content." });
    }
  });

export type ImplementationResult = z.infer<typeof implementationResultSchema>;

export function createImplementationArtifactContractMetadata() {
  return {
    expectedImplementationResultSchemaId: implementationResultSchemaId,
    implementationMetadataKind: "implementation_result_contract" as const,
    implementationVersion: 1 as const,
  };
}
