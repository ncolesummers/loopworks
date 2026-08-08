import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(__dirname, "../../..");

function writeUInt32BE(input: number[], offset: number, value: number) {
  input[offset] = value >>> 24;
  input[offset + 1] = value >>> 16;
  input[offset + 2] = value >>> 8;
  input[offset + 3] = value;
}

function writeAscii(input: number[], offset: number, value: string) {
  for (const [index, character] of [...value].entries()) {
    input[offset + index] = character.charCodeAt(0);
  }
}

function zeroLengthIcnsEntry(): number[] {
  const input = Array<number>(16).fill(0);
  writeAscii(input, 0, "icns");
  writeUInt32BE(input, 4, input.length);
  writeAscii(input, 8, "ic07");
  return input;
}

function zeroLengthJxlBox(): number[] {
  const input = Array<number>(36).fill(0);
  writeUInt32BE(input, 0, 12);
  writeAscii(input, 4, "JXL ");
  writeUInt32BE(input, 12, 12);
  writeAscii(input, 16, "ftyp");
  writeAscii(input, 20, "jxl ");
  writeAscii(input, 28, "jxlp");
  return input;
}

function zeroLengthHeifBox(): number[] {
  const input = Array<number>(64).fill(0);
  writeUInt32BE(input, 0, 12);
  writeAscii(input, 4, "ftyp");
  writeAscii(input, 8, "avif");
  writeUInt32BE(input, 12, 52);
  writeAscii(input, 16, "meta");
  writeUInt32BE(input, 24, 40);
  writeAscii(input, 28, "iprp");
  writeUInt32BE(input, 32, 32);
  writeAscii(input, 36, "ipco");
  writeAscii(input, 44, "ispe");
  writeUInt32BE(input, 52, 1);
  writeUInt32BE(input, 56, 1);
  return input;
}

describe("patched image-size parsers", () => {
  it("installs the reviewed patch through Bun", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      patchedDependencies?: Record<string, string>;
    };
    expect(packageJson.patchedDependencies?.["image-size@2.0.2"]).toBe(
      "patches/image-size@2.0.2.patch",
    );
    const patch = readFileSync(path.join(repoRoot, "patches/image-size@2.0.2.patch"), "utf8");
    expect(patch).toContain("Invalid ICNS entry length");
    expect(patch).toContain("Invalid JXL box size");
    expect(patch).toContain("Invalid HEIF ispe box size");

    const lockfile = parse(readFileSync(path.join(repoRoot, "bun.lock"), "utf8")) as {
      patchedDependencies?: Record<string, string>;
    };
    expect(lockfile.patchedDependencies?.["image-size@2.0.2"]).toBe(
      "patches/image-size@2.0.2.patch",
    );
  });

  it.each([
    ["ICNS", zeroLengthIcnsEntry()],
    ["JXL", zeroLengthJxlBox()],
    ["HEIF", zeroLengthHeifBox()],
  ])("rejects a zero-length %s box without blocking the event loop", (_format, bytes) => {
    const script = [
      'import { imageSize } from "image-size";',
      `const input = Uint8Array.from(${JSON.stringify(bytes)});`,
      "try { imageSize(input); } catch {}",
    ].join("\n");
    expect(() =>
      execFileSync("node", ["--input-type=module", "--eval", script], {
        cwd: repoRoot,
        timeout: 750,
      }),
    ).not.toThrow();
  });
});
