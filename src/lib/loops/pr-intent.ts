import { z } from "zod";

import {
  summarizeValidationReport,
  type ValidationReportV1,
  validationReportSchemaId,
} from "@/lib/loops/validation-report";

export const prIntentSchemaId = "loopworks.pr_intent.v1" as const;
export const prIntentVersion = 1 as const;

const safeUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  const sensitiveKey =
    /^(?:access_?token|auth(?:orization)?|credential|password|secret|api[-_]?key)$/i;
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    ![...url.searchParams.keys()].some((key) => sensitiveKey.test(key)) &&
    !/(?:^|[&#])(?:access_?token|auth(?:orization)?|credential|password|secret|api[-_]?key)=/i.test(
      url.hash,
    )
  );
}, "Links must use HTTP(S) and must not contain credentials or sensitive query data.");

const prIntentLinkSchema = z
  .object({
    title: z.string().min(1),
    type: z.string().min(1),
    uri: safeUrlSchema,
  })
  .strict();

const prIntentDeploymentSchema = z
  .object({
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    environment: z.string().min(1),
    status: z.string().min(1),
    url: safeUrlSchema,
  })
  .strict();

export const prIntentV1Schema = z
  .object({
    artifacts: z.array(prIntentLinkSchema),
    body: z.string().min(1),
    changeDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    deployment: prIntentDeploymentSchema.optional(),
    run: z
      .object({
        id: z.uuid(),
        url: safeUrlSchema,
      })
      .strict(),
    schemaId: z.literal(prIntentSchemaId),
    sourceIssue: z
      .object({
        number: z.number().int().positive(),
        title: z.string().min(1),
        url: safeUrlSchema,
      })
      .strict(),
    title: z.string().min(1),
    validation: z
      .object({
        artifactUri: safeUrlSchema,
        reportSchemaId: z.literal(validationReportSchemaId),
        summary: z.string().min(1),
      })
      .strict(),
    version: z.literal(prIntentVersion),
  })
  .strict();

export const prIntentArtifactContractMetadataSchema = z
  .object({
    expectedPrIntentSchemaId: z.literal(prIntentSchemaId),
    prIntentMetadataKind: z.literal("pr_intent_contract"),
    prIntentVersion: z.literal(prIntentVersion),
  })
  .strict();

export const prIntentArtifactMetadataSchema = z
  .object({
    githubPullRequest: z
      .object({
        headBranch: z.string().min(1),
        headSha: z.string().min(1),
        number: z.number().int().positive(),
        url: safeUrlSchema,
      })
      .strict()
      .optional(),
    prIntent: prIntentV1Schema,
    prIntentMetadataKind: z.literal("pr_intent_result"),
    prIntentSchemaId: z.literal(prIntentSchemaId),
    prIntentVersion: z.literal(prIntentVersion),
    prPreparationResult: z.unknown().optional(),
    prPreparationResultSchemaId: z.literal("loopworks.pr_preparation_result.v1").optional(),
    prPreparationResultSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export type PrIntentV1 = z.infer<typeof prIntentV1Schema>;
export type PrIntentArtifactContractMetadata = z.infer<
  typeof prIntentArtifactContractMetadataSchema
>;
export type PrIntentArtifactMetadata = z.infer<typeof prIntentArtifactMetadataSchema>;

type ComposePrIntentInput = {
  artifacts: Array<z.input<typeof prIntentLinkSchema>>;
  changeDigest?: string;
  deployment?: z.input<typeof prIntentDeploymentSchema>;
  issue: {
    number: number;
    title: string;
    url: string;
  };
  run: {
    id: string;
    url: string;
  };
  screenshots?: Array<{
    id: string;
    testId: string;
    viewport: "mobile" | "laptop" | "desktop";
    uri: string;
  }>;
  summary?: string;
  title?: string;
  validation: {
    artifactUri: string;
    report: ValidationReportV1;
  };
};

function singleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function sanitizeText(value: string): string {
  return singleLine(value)
    .replaceAll(
      /-----BEGIN [^-]+ PRIVATE KEY-----.*?-----END [^-]+ PRIVATE KEY-----/gi,
      "[redacted private key]",
    )
    .replaceAll(/\braw\s+prompt\b.*$/gi, "raw prompt [redacted]")
    .replaceAll(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replaceAll(
      /\b(token|secret|password|authorization|credential|api[-_]?key|prompt)(\s*[:=]\s*)\S+/gi,
      "$1$2[redacted]",
    )
    .replaceAll(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+\b/g, "[redacted]")
    .replaceAll(/-----BEGIN [^-]+ PRIVATE KEY-----/gi, "[redacted private key]");
}

function escapeMarkdownLabel(value: string): string {
  return singleLine(value).replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function markdownLink(label: string, url: string): string {
  return `[${escapeMarkdownLabel(label)}](${url})`;
}

export function composePrIntent(input: ComposePrIntentInput): PrIntentV1 {
  const sourceIssue = {
    number: input.issue.number,
    title: sanitizeText(input.issue.title),
    url: input.issue.url,
  };
  const run = {
    id: input.run.id,
    url: input.run.url,
  };
  const artifacts = [...input.artifacts]
    .map((artifact) =>
      prIntentLinkSchema.parse({
        ...artifact,
        title: sanitizeText(artifact.title),
        type: sanitizeText(artifact.type),
      }),
    )
    .sort((left, right) =>
      `${left.type}\u0000${left.title}\u0000${left.uri}`.localeCompare(
        `${right.type}\u0000${right.title}\u0000${right.uri}`,
      ),
    );
  const deployment = input.deployment
    ? prIntentDeploymentSchema.parse({
        ...input.deployment,
        ...(input.deployment.branch ? { branch: sanitizeText(input.deployment.branch) } : {}),
        ...(input.deployment.commitSha
          ? { commitSha: sanitizeText(input.deployment.commitSha) }
          : {}),
        environment: sanitizeText(input.deployment.environment),
        status: sanitizeText(input.deployment.status),
      })
    : undefined;
  const validationSummary = summarizeValidationReport(input.validation.report);
  const artifactLines = artifacts.length
    ? artifacts.map(
        (artifact) => `- ${markdownLink(artifact.title, artifact.uri)} (${artifact.type})`,
      )
    : ["- No additional run artifacts were recorded."];
  const deploymentLines = deployment
    ? [
        `- Environment: ${escapeMarkdownLabel(deployment.environment)}`,
        `- Status: ${escapeMarkdownLabel(deployment.status)}`,
        `- Preview: ${markdownLink(deployment.url, deployment.url)}`,
        ...(deployment.branch ? [`- Branch: \`${escapeMarkdownLabel(deployment.branch)}\``] : []),
        ...(deployment.commitSha
          ? [`- Commit: \`${escapeMarkdownLabel(deployment.commitSha)}\``]
          : []),
      ]
    : ["- No deployment context was recorded for this run."];
  const screenshotLines = input.screenshots?.length
    ? input.screenshots.map(
        (screenshot) =>
          `- ${escapeMarkdownLabel(screenshot.testId)} (${screenshot.viewport}): \`${screenshot.uri}\``,
      )
    : ["- No UI screenshot references were recorded for this run."];
  const title = sanitizeText(input.title ?? `Issue #${sourceIssue.number}: ${sourceIssue.title}`);
  const summary = input.summary ? sanitizeText(input.summary) : undefined;
  const body = [
    "## Summary",
    "",
    ...(summary ? [summary, ""] : []),
    `- ${markdownLink(`Source issue #${sourceIssue.number}`, sourceIssue.url)}`,
    `- ${markdownLink("Loopworks run", run.url)}`,
    ...(input.changeDigest ? [`- Approved change digest: \`${input.changeDigest}\``] : []),
    "",
    "## Validation",
    "",
    validationSummary,
    "",
    `- ${markdownLink("Validation report", input.validation.artifactUri)}`,
    "",
    "## Deployment",
    "",
    ...deploymentLines,
    "",
    "## Artifacts",
    "",
    ...artifactLines,
    "",
    "## Screenshots",
    "",
    ...screenshotLines,
    "",
    `Closes #${sourceIssue.number}`,
  ].join("\n");

  return prIntentV1Schema.parse({
    artifacts,
    body,
    ...(input.changeDigest ? { changeDigest: input.changeDigest } : {}),
    ...(deployment ? { deployment } : {}),
    run,
    schemaId: prIntentSchemaId,
    sourceIssue,
    title,
    validation: {
      artifactUri: input.validation.artifactUri,
      reportSchemaId: validationReportSchemaId,
      summary: validationSummary,
    },
    version: prIntentVersion,
  });
}

export function createPrIntentArtifactContractMetadata(): PrIntentArtifactContractMetadata {
  return prIntentArtifactContractMetadataSchema.parse({
    expectedPrIntentSchemaId: prIntentSchemaId,
    prIntentMetadataKind: "pr_intent_contract",
    prIntentVersion,
  });
}

export function createPrIntentArtifactMetadata(intent: PrIntentV1): PrIntentArtifactMetadata {
  return prIntentArtifactMetadataSchema.parse({
    prIntent: intent,
    prIntentMetadataKind: "pr_intent_result",
    prIntentSchemaId,
    prIntentVersion,
  });
}
