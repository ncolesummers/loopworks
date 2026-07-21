/** @vitest-environment node */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  assertScreenshotEvidenceBinding,
  assertScreenshotEvidenceCoverage,
  captureValidationScreenshots,
  classifyUiAffectingChange,
  computeScreenshotEvidenceDigest,
  screenshotEvidenceSchema,
  screenshotEvidenceSchemaId,
  validationScreenshotViewports,
} from "@/lib/loops/screenshot-evidence";
import validationEvidencePlaywrightConfig from "../../../playwright.validation-evidence.config";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0, 0, 0, 1, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0, 0], 33);
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0], 46);
  return bytes;
}

const browserTest = {
  id: "browser-ac-1",
  type: "browser" as const,
  path: "tests/e2e/review.spec.ts",
};

describe("validation screenshot evidence", () => {
  it("configures Playwright to retain final states at every evidence viewport", () => {
    expect(validationEvidencePlaywrightConfig.use?.screenshot).toBe("on");
    expect(validationEvidencePlaywrightConfig.outputDir).toBe("test-results/validation-evidence");
    expect(
      validationEvidencePlaywrightConfig.projects?.map(({ name, use }) => ({
        name,
        viewport: use?.viewport,
      })),
    ).toEqual([
      { name: "validation-mobile", viewport: { width: 390, height: 844 } },
      { name: "validation-laptop", viewport: { width: 1280, height: 832 } },
      { name: "validation-desktop", viewport: { width: 1440, height: 960 } },
    ]);
  });

  it("exposes the validation evidence Playwright configuration as a runnable script", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts?.["test:e2e:validation-evidence"]).toBe(
      "playwright test --config=playwright.validation-evidence.config.ts",
    );
  });

  it("classifies UI-affecting production and test paths deterministically", () => {
    expect(
      classifyUiAffectingChange({ productionPaths: ["src/components/card.tsx"], tests: [] }),
    ).toBe(true);
    expect(
      classifyUiAffectingChange({ productionPaths: ["src/lib/parser.ts"], tests: [browserTest] }),
    ).toBe(true);
    expect(classifyUiAffectingChange({ productionPaths: ["src/lib/parser.ts"], tests: [] })).toBe(
      false,
    );
    expect(classifyUiAffectingChange({ productionPaths: ["public/logo.svg"], tests: [] })).toBe(
      true,
    );
  });

  it("captures every browser test at mobile, laptop, and desktop viewports", async () => {
    const capture = vi.fn(async ({ viewport }) => png(viewport.width, viewport.height));
    const write = vi.fn(async ({ id, bytes }: { id: string; bytes: Uint8Array }) => ({
      uri: `artifact://screenshots/${id}.png`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.byteLength,
    }));

    const evidence = await captureValidationScreenshots({
      binding: {
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
        testPlanSha256: "b".repeat(64),
        productionPatchSha256: "c".repeat(64),
      },
      productionPaths: ["src/components/card.tsx"],
      tests: [browserTest],
      capture,
      write,
    });

    expect(validationScreenshotViewports).toEqual([
      { name: "mobile", width: 390, height: 844 },
      { name: "laptop", width: 1280, height: 832 },
      { name: "desktop", width: 1440, height: 960 },
    ]);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(3);
    expect(evidence.captures.map(({ viewport }) => viewport)).toEqual([
      "mobile",
      "laptop",
      "desktop",
    ]);
    expect(screenshotEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(computeScreenshotEvidenceDigest(evidence)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records an empty non-UI manifest and fails closed for incomplete UI evidence", async () => {
    const nonUi = await captureValidationScreenshots({
      binding: {
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
        testPlanSha256: "b".repeat(64),
        productionPatchSha256: "c".repeat(64),
      },
      productionPaths: ["src/lib/parser.ts"],
      tests: [],
      capture: vi.fn(),
      write: vi.fn(),
    });
    expect(nonUi).toMatchObject({
      schemaId: screenshotEvidenceSchemaId,
      uiAffecting: false,
      browserTestIds: [],
      captures: [],
    });

    const incomplete = {
      ...nonUi,
      uiAffecting: true,
      browserTestIds: ["browser-ac-1"],
      captures: [],
    };
    expect(screenshotEvidenceSchema.safeParse(incomplete).success).toBe(false);
  });

  it("rejects non-PNG capture bytes", async () => {
    await expect(
      captureValidationScreenshots({
        binding: {
          repositoryFullName: "ncolesummers/loopworks",
          commitSha: "a".repeat(40),
          testPlanSha256: "b".repeat(64),
          productionPatchSha256: "c".repeat(64),
        },
        productionPaths: ["src/components/card.tsx"],
        tests: [browserTest],
        capture: async () => Uint8Array.from([1, 2, 3]),
        write: vi.fn(),
      }),
    ).rejects.toThrow("PNG");
  });

  it("rejects forged writer digests and stale handoff bindings", async () => {
    await expect(
      captureValidationScreenshots({
        binding: {
          repositoryFullName: "ncolesummers/loopworks",
          commitSha: "a".repeat(40),
          testPlanSha256: "b".repeat(64),
          productionPatchSha256: "c".repeat(64),
        },
        productionPaths: ["src/components/card.tsx"],
        tests: [browserTest],
        capture: async ({ viewport }) => png(viewport.width, viewport.height),
        write: async () => ({
          uri: "artifact://screenshots/forged.png",
          sha256: "0".repeat(64),
          byteCount: png(390, 844).byteLength,
        }),
      }),
    ).rejects.toThrow("digest");

    await expect(
      captureValidationScreenshots({
        binding: {
          repositoryFullName: "ncolesummers/loopworks",
          commitSha: "a".repeat(40),
          testPlanSha256: "b".repeat(64),
          productionPatchSha256: "c".repeat(64),
        },
        productionPaths: ["src/components/card.tsx"],
        tests: [browserTest],
        capture: async ({ viewport }) => png(viewport.width, viewport.height),
        write: async () => ({ uri: "artifact://screenshots/collision.png" }),
      }),
    ).rejects.toThrow("Duplicate screenshot URI");

    const evidence = screenshotEvidenceSchema.parse({
      version: 1,
      schemaId: screenshotEvidenceSchemaId,
      binding: {
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
        testPlanSha256: "b".repeat(64),
        productionPatchSha256: "c".repeat(64),
      },
      uiAffecting: false,
      browserTestIds: [],
      captures: [],
    });
    expect(() =>
      assertScreenshotEvidenceBinding(evidence, {
        ...evidence.binding,
        productionPatchSha256: "d".repeat(64),
      }),
    ).toThrow("bound");
  });

  it("rejects declared dimensions and browser ids that do not match captured evidence", async () => {
    const binding = {
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "a".repeat(40),
      testPlanSha256: "b".repeat(64),
      productionPatchSha256: "c".repeat(64),
    };
    await expect(
      captureValidationScreenshots({
        binding,
        productionPaths: ["src/components/card.tsx"],
        tests: [browserTest],
        capture: async () => png(390, 844),
        write: async ({ id }) => ({ uri: `artifact://screenshots/${id}.png` }),
      }),
    ).rejects.toThrow("dimensions");

    const valid = await captureValidationScreenshots({
      binding,
      productionPaths: ["src/components/card.tsx"],
      tests: [browserTest],
      capture: async ({ viewport }) => png(viewport.width, viewport.height),
      write: async ({ id }) => ({ uri: `artifact://screenshots/${id}.png` }),
    });
    expect(() =>
      assertScreenshotEvidenceCoverage(valid, {
        uiAffecting: true,
        browserTestIds: ["different-browser-test"],
      }),
    ).toThrow("browser tests");
  });
});
