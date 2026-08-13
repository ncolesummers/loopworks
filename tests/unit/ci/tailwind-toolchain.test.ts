import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  devDependencies?: Record<string, string>;
};

type BiomeConfig = {
  css?: {
    parser?: {
      tailwindDirectives?: boolean;
    };
  };
};

type ComponentsConfig = {
  tailwind?: {
    config?: string;
    css?: string;
  };
};

const repositoryRoot = path.resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("Tailwind CSS 4 toolchain", () => {
  it("uses the supported PostCSS integration and CSS-first entry point", () => {
    const manifest = readJson<PackageManifest>("package.json");
    const biomeConfig = readJson<BiomeConfig>("biome.json");
    const componentsConfig = readJson<ComponentsConfig>("components.json");
    const postcssConfig = read("postcss.config.mjs");
    const stylesheet = read("src/app/globals.css");

    expect(manifest.devDependencies?.tailwindcss).toBe("^4.3.3");
    expect(manifest.devDependencies?.["@tailwindcss/postcss"]).toBe("^4.3.3");
    expect(manifest.devDependencies).not.toHaveProperty("autoprefixer");
    expect(biomeConfig.css?.parser?.tailwindDirectives).toBe(true);
    expect(componentsConfig.tailwind).toMatchObject({
      config: "",
      css: "src/app/globals.css",
    });

    expect(postcssConfig).toContain('"@tailwindcss/postcss": {}');
    expect(postcssConfig).not.toMatch(/^\s*tailwindcss:/m);
    expect(postcssConfig).not.toContain("autoprefixer");

    expect(stylesheet).toContain('@import "tailwindcss" source("../");');
    expect(stylesheet).toContain("@custom-variant dark (&:where(.dark, .dark *));");
    expect(stylesheet).toContain('@plugin "@tailwindcss/forms";');
    expect(stylesheet).toContain('@plugin "@tailwindcss/typography";');
    expect(stylesheet).toContain("@theme inline {");
    expect(stylesheet).not.toContain("@tailwind base");
    expect(existsSync(path.join(repositoryRoot, "tailwind.config.ts"))).toBe(false);
  });

  it("keeps the Loopworks runtime tokens and font sources wired into generated utilities", () => {
    const stylesheet = read("src/app/globals.css");
    const fonts = read("src/lib/fonts.ts");

    for (const token of [
      "background",
      "foreground",
      "border",
      "brand",
      "primary",
      "success",
      "warning",
      "danger",
      "info",
    ]) {
      expect(stylesheet).toContain(`--color-${token}: hsl(var(--${token}));`);
    }

    expect(fonts).toContain('variable: "--font-mona-sans"');
    expect(fonts).toContain('variable: "--font-monaspace-neon"');
    expect(stylesheet).toMatch(/--font-sans:\s*var\(--font-mona-sans\)/);
    expect(stylesheet).toMatch(/--font-mono:\s*var\(--font-monaspace-neon\)/);
    expect(stylesheet).toContain("--radius-lg: var(--radius)");
    expect(stylesheet).toContain("--shadow-subtle: 0 1px 2px rgb(0 0 0 / 0.06)");
    expect(stylesheet).toContain("@media (width >= 90rem)");
  });

  it("does not retain v3 utility names whose visual meaning changed in v4", () => {
    const sources = sourceFiles(path.join(repositoryRoot, "src"))
      .map((sourcePath) => readFileSync(sourcePath, "utf8"))
      .join("\n");

    expect(sources).not.toMatch(/\bshadow-sm\b/);
    expect(sources).not.toMatch(/\boutline-none\b/);
  });

  it("compiles the real application stylesheet into representative utilities", async () => {
    const [{ default: postcss }, { default: tailwindcss }] = await Promise.all([
      import("postcss"),
      import("@tailwindcss/postcss"),
    ]);
    const stylesheetPath = path.join(repositoryRoot, "src/app/globals.css");
    const result = await postcss([tailwindcss()]).process(
      `${readFileSync(stylesheetPath, "utf8")}\n@source inline("container prose");`,
      { from: stylesheetPath },
    );

    expect(result.css).toContain(".bg-background");
    expect(result.css).toContain(".dark\\:scale-100");
    expect(result.css).toContain(".font-mono");
    expect(result.css).toContain(".prose");
    expect(result.css).toContain("input:where([type='text'])");
    expect(result.css).toMatch(
      /\.bg-background\s*\{\s*background-color: hsl\(var\(--background\)\)/,
    );
    expect(result.css).toMatch(/\.rounded-lg\s*\{\s*border-radius: var\(--radius\)/);
    expect(result.css).toMatch(/\.shadow-xs\s*\{[^}]*0 1px 2px 0/);

    const container = result.root.nodes.find(
      (node) => node.type === "atrule" && node.name === "layer" && node.params === "utilities",
    );
    const containerRule =
      container?.type === "atrule"
        ? container.nodes?.find((node) => node.type === "rule" && node.selector === ".container")
        : undefined;
    expect(containerRule?.type).toBe("rule");
    if (containerRule?.type !== "rule") throw new Error("compiled .container utility missing");

    const directMaxWidths = containerRule.nodes
      .filter((node) => node.type === "decl" && node.prop === "max-width")
      .map((node) => (node.type === "decl" ? node.value : ""));
    expect(directMaxWidths).toEqual(["none"]);
    expect(result.css).toMatch(/@media \(width >= 90rem\) \{\s+max-width: 90rem;/);
  });
});
