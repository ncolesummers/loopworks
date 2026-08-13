import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type TypeScriptConfig = {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
};

const repositoryRoot = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8")) as T;
}

describe("TypeScript 7 toolchain", () => {
  it("runs the native TypeScript 7 compiler while retaining the TypeScript 6 API", async () => {
    const manifest = readJson<PackageManifest>("package.json");

    expect(manifest.devDependencies?.["@typescript/typescript6"]).toBe("^6.0.2");
    expect(manifest.devDependencies?.typescript).toBe("^7.0.2");
    expect(manifest.scripts?.typecheck).toBe("node node_modules/typescript/lib/tsc.js --noEmit");

    const compiler = spawnSync("bun", ["run", "typecheck", "--", "--version"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(compiler.error).toBeUndefined();
    expect(compiler.status).toBe(0);
    expect(compiler.stdout).toContain("Version 7.0.2");

    const conventionalCompiler = spawnSync(
      path.join(repositoryRoot, "node_modules/.bin/tsc"),
      ["--version"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );
    expect(conventionalCompiler.error).toBeUndefined();
    expect(conventionalCompiler.status).toBe(0);
    expect(conventionalCompiler.stdout.trim()).toBe("Version 7.0.2");

    const nextTypeScript = await import("next/dist/lib/typescript/runTypeScriptCli.js");
    expect(nextTypeScript.getTypeScriptPackageInfo(repositoryRoot)).toMatchObject({
      version: "7.0.2",
    });

    const compatibilityModule = await import("@typescript/typescript6");
    const compatibilityApi = compatibilityModule.default;
    expect(compatibilityApi.version).toMatch(/^6\./);
    expect(compatibilityApi.createSourceFile).toBeTypeOf("function");
  });

  it("uses TypeScript 7-compatible path aliases without baseUrl", () => {
    const config = readJson<TypeScriptConfig>("tsconfig.json");

    expect(config.compilerOptions).not.toHaveProperty("baseUrl");
    expect(config.compilerOptions?.paths).toEqual({
      "@/*": ["./src/*"],
      "@agent/*": ["./agent/*"],
    });
  });
});
