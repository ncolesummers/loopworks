import { createHash } from "node:crypto";

import { canonicalJsonStringify } from "@agent/lib/canonical-json";
import { screenshotArtifactUriSchema } from "@agent/lib/screenshot-artifact-uri";
import { z } from "zod";

export const screenshotEvidenceSchemaId = "loopworks.screenshot_evidence.v1";
export const validationScreenshotViewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 832 },
  { name: "desktop", width: 1440, height: 960 },
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const repositorySchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const viewportNameSchema = z.enum(validationScreenshotViewports.map(({ name }) => name));

const screenshotCaptureSchema = z
  .object({
    id: identifierSchema,
    testId: identifierSchema,
    viewport: viewportNameSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z.literal("image/png"),
    uri: screenshotArtifactUriSchema,
    sha256: sha256Schema,
    byteCount: z.number().int().positive(),
  })
  .strict();

export const screenshotEvidenceSchema = z
  .object({
    version: z.literal(1),
    schemaId: z.literal(screenshotEvidenceSchemaId),
    binding: z
      .object({
        repositoryFullName: repositorySchema,
        commitSha: z.string().regex(/^[a-f0-9]{40}$/),
        testPlanSha256: sha256Schema,
        productionPatchSha256: sha256Schema,
      })
      .strict(),
    uiAffecting: z.boolean(),
    browserTestIds: z.array(identifierSchema),
    captures: z.array(screenshotCaptureSchema),
  })
  .strict()
  .superRefine((evidence, context) => {
    const browserTestIds = new Set(evidence.browserTestIds);
    if (browserTestIds.size !== evidence.browserTestIds.length) {
      context.addIssue({ code: "custom", message: "Browser test ids must be unique." });
    }
    const captureIds = new Set<string>();
    const captureKeys = new Set<string>();
    const captureUris = new Set<string>();
    for (const [index, capture] of evidence.captures.entries()) {
      if (captureIds.has(capture.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate screenshot capture ${capture.id}.`,
          path: ["captures", index, "id"],
        });
      }
      captureIds.add(capture.id);
      if (captureUris.has(capture.uri)) {
        context.addIssue({ code: "custom", message: `Duplicate screenshot URI ${capture.uri}.` });
      }
      captureUris.add(capture.uri);
      if (!browserTestIds.has(capture.testId)) {
        context.addIssue({
          code: "custom",
          message: `Screenshot references unknown browser test ${capture.testId}.`,
          path: ["captures", index, "testId"],
        });
      }
      const viewport = validationScreenshotViewports.find(({ name }) => name === capture.viewport);
      if (!viewport || viewport.width !== capture.width || viewport.height !== capture.height) {
        context.addIssue({
          code: "custom",
          message: `Screenshot dimensions do not match ${capture.viewport}.`,
          path: ["captures", index],
        });
      }
      const key = `${capture.testId}:${capture.viewport}`;
      if (captureKeys.has(key)) {
        context.addIssue({ code: "custom", message: `Duplicate screenshot target ${key}.` });
      }
      captureKeys.add(key);
    }
    if (!evidence.uiAffecting) {
      if (evidence.browserTestIds.length > 0 || evidence.captures.length > 0) {
        context.addIssue({ code: "custom", message: "Non-UI evidence cannot contain captures." });
      }
      return;
    }
    if (evidence.browserTestIds.length === 0) {
      context.addIssue({ code: "custom", message: "UI evidence requires a browser test." });
    }
    for (const testId of evidence.browserTestIds) {
      for (const viewport of validationScreenshotViewports) {
        if (!captureKeys.has(`${testId}:${viewport.name}`)) {
          context.addIssue({
            code: "custom",
            message: `Missing ${viewport.name} screenshot for ${testId}.`,
          });
        }
      }
    }
  });

export type ScreenshotEvidence = z.infer<typeof screenshotEvidenceSchema>;
export type ValidationScreenshotViewport = (typeof validationScreenshotViewports)[number];
export type ScreenshotTest = { id: string; path: string; type: "unit" | "integration" | "browser" };
export type CaptureValidationScreenshotsInput = {
  binding: ScreenshotEvidence["binding"];
  productionPaths: readonly string[];
  tests: readonly ScreenshotTest[];
  capture: (input: {
    test: ScreenshotTest;
    viewport: ValidationScreenshotViewport;
  }) => Promise<Uint8Array>;
  write: (input: {
    bytes: Uint8Array;
    id: string;
    test: ScreenshotTest;
    viewport: ValidationScreenshotViewport;
  }) => Promise<{ uri: string; sha256?: string; byteCount?: number }>;
};

export function computeScreenshotEvidenceDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

export function assertScreenshotEvidenceBinding(
  evidence: ScreenshotEvidence,
  expected: ScreenshotEvidence["binding"],
): ScreenshotEvidence {
  if (
    evidence.binding.repositoryFullName !== expected.repositoryFullName ||
    evidence.binding.commitSha !== expected.commitSha ||
    evidence.binding.testPlanSha256 !== expected.testPlanSha256 ||
    evidence.binding.productionPatchSha256 !== expected.productionPatchSha256
  ) {
    throw new Error("Screenshot evidence is not bound to the persisted validation handoff.");
  }
  return evidence;
}

const uiProductionPathPattern =
  /^(?:src\/(?:app|components)\/|src\/.*\.(?:css|scss|sass|less)$|public\/.*\.(?:svg|png|jpe?g|gif|webp|avif|ico)$)/i;
const storyPathPattern = /(?:^|\/)(?:stories)(?:\/|$)|\.stories\.[^/]+$/i;

export function screenshotBrowserTests(tests: readonly ScreenshotTest[]): ScreenshotTest[] {
  return tests.filter(({ type, path }) => type === "browser" || storyPathPattern.test(path));
}

export function classifyUiAffectingChange(input: {
  productionPaths: readonly string[];
  tests: readonly ScreenshotTest[];
}): boolean {
  return (
    input.productionPaths.some((path) => uiProductionPathPattern.test(path)) ||
    input.tests.some((test) => test.type === "browser" || storyPathPattern.test(test.path))
  );
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 58 || !signature.every((value, index) => bytes[index] === value)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let dimensions: { width: number; height: number } | undefined;
  let hasImageData = false;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return undefined;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return undefined;
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (width === 0 || height === 0) return undefined;
      dimensions = { width, height };
    } else if (type === "IDAT" && length > 0) {
      hasImageData = true;
    } else if (type === "IEND" && length === 0) {
      hasEnd = end === bytes.length;
      break;
    }
    offset = end;
  }
  return dimensions && hasImageData && hasEnd ? dimensions : undefined;
}

export function assertScreenshotEvidenceCoverage(
  evidence: ScreenshotEvidence,
  expected: { browserTestIds: readonly string[]; uiAffecting: boolean },
): ScreenshotEvidence {
  if (
    evidence.uiAffecting !== expected.uiAffecting ||
    JSON.stringify([...evidence.browserTestIds].sort()) !==
      JSON.stringify([...expected.browserTestIds].sort())
  ) {
    throw new Error("Screenshot evidence does not cover the persisted browser tests.");
  }
  return evidence;
}

export async function captureValidationScreenshots(
  input: CaptureValidationScreenshotsInput,
): Promise<ScreenshotEvidence> {
  const uiAffecting = classifyUiAffectingChange(input);
  const browserTests = screenshotBrowserTests(input.tests);
  if (!uiAffecting) {
    return screenshotEvidenceSchema.parse({
      version: 1,
      schemaId: screenshotEvidenceSchemaId,
      binding: input.binding,
      uiAffecting: false,
      browserTestIds: [],
      captures: [],
    });
  }
  if (browserTests.length === 0) {
    throw new Error("UI-affecting validation requires a browser test journey.");
  }

  const captures: ScreenshotEvidence["captures"] = [];
  for (const test of browserTests) {
    for (const viewport of validationScreenshotViewports) {
      const id = `${test.id}-${viewport.name}`;
      const bytes = await input.capture({ test, viewport });
      const dimensions = pngDimensions(bytes);
      if (!dimensions) throw new Error(`Screenshot ${id} is not a structurally valid PNG.`);
      if (dimensions.width !== viewport.width || dimensions.height !== viewport.height) {
        throw new Error(`Screenshot ${id} dimensions do not match the requested viewport.`);
      }
      const written = await input.write({ bytes, id, test, viewport });
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (written.sha256 && written.sha256 !== digest) {
        throw new Error(`Screenshot ${id} writer returned a forged digest.`);
      }
      if (written.byteCount !== undefined && written.byteCount !== bytes.byteLength) {
        throw new Error(`Screenshot ${id} writer returned a forged byte count.`);
      }
      captures.push({
        id,
        testId: test.id,
        viewport: viewport.name,
        width: viewport.width,
        height: viewport.height,
        mimeType: "image/png",
        uri: written.uri,
        sha256: digest,
        byteCount: written.byteCount ?? bytes.byteLength,
      });
    }
  }

  return screenshotEvidenceSchema.parse({
    version: 1,
    schemaId: screenshotEvidenceSchemaId,
    binding: input.binding,
    uiAffecting: true,
    browserTestIds: browserTests.map(({ id }) => id),
    captures,
  });
}

export function createScreenshotEvidenceArtifactContractMetadata() {
  return {
    expectedScreenshotEvidenceSchemaId: screenshotEvidenceSchemaId,
    screenshotEvidenceMetadataKind: "screenshot_evidence_contract" as const,
    screenshotEvidenceVersion: 1 as const,
  };
}

export function createScreenshotEvidenceArtifactMetadata(evidence: ScreenshotEvidence) {
  return {
    screenshotEvidence: screenshotEvidenceSchema.parse(evidence),
    screenshotEvidenceMetadataKind: "screenshot_evidence_result" as const,
    screenshotEvidenceSchemaId,
    screenshotEvidenceVersion: 1 as const,
  };
}
