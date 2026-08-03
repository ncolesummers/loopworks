import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  authDevelopmentSecret,
  configRegistry,
  readConfigValue,
  readStringConfig,
  resolveConfigRuntimeContext,
  validateConfig,
} from "@/lib/config/registry";

const productionRequiredNames = [
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "AUTH_SECRET",
  "DATABASE_URL",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "LOOPWORKS_EVE_TEST_RECEIPT_SECRET",
];

const validProductionConfig = {
  AUTH_GITHUB_ID: "github-client-id",
  AUTH_GITHUB_SECRET: "github-client-secret",
  AUTH_SECRET: "production-auth-secret",
  DATABASE_URL: "postgres://user:secret@database.example.com/loopworks",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "private-key",
  GITHUB_WEBHOOK_SECRET: "production-webhook-secret",
  LOOPWORKS_EVE_TEST_RECEIPT_SECRET: "production-receipt-secret",
};

function envExampleNames(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
}

describe("configuration registry", () => {
  it("declares every generated environment example entry without duplicate names", async () => {
    const example = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
    const registryNames = configRegistry.map((entry) => entry.name);
    const registryNameSet = new Set<string>(registryNames);

    expect(new Set(registryNames).size).toBe(registryNames.length);
    expect(envExampleNames(example).filter((name) => !registryNameSet.has(name))).toEqual([]);
  });

  it("declares the approved core control-plane variables as production-required", () => {
    expect(
      configRegistry
        .filter((entry) => entry.requiredIn.some((context) => context === "production"))
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(productionRequiredNames);
  });

  it("declares the auth development fallback but rejects it in production", () => {
    expect(readConfigValue("AUTH_SECRET", {}, "development")).toBe(authDevelopmentSecret);
    expect(() => readConfigValue("AUTH_SECRET", {}, "production")).toThrow(/AUTH_SECRET.*auth/i);
    expect(() =>
      readConfigValue("AUTH_SECRET", { AUTH_SECRET: authDevelopmentSecret }, "production"),
    ).toThrow(/AUTH_SECRET.*auth/i);
    expect(() =>
      readConfigValue("AUTH_SECRET", { AUTH_SECRET: ` ${authDevelopmentSecret}\n` }, "production"),
    ).toThrow(/AUTH_SECRET.*auth/i);
  });

  it("keeps configuration names as a compile-time registry union", () => {
    const misspelledConfigRead = () => {
      // @ts-expect-error misspelled names must not compile
      readStringConfig("AUTH_SECRT");
    };
    expect(misspelledConfigRead).toBeTypeOf("function");
    expect(readStringConfig("AUTH_SECRET", {}, "development")).toBe(authDevelopmentSecret);
  });

  it("preserves byte-sensitive secret values and applies defaults only when undefined", () => {
    expect(
      readConfigValue(
        "GITHUB_WEBHOOK_SECRET",
        { GITHUB_WEBHOOK_SECRET: "  byte-sensitive-secret  " },
        "development",
      ),
    ).toBe("  byte-sensitive-secret  ");
    expect(readConfigValue("AUTH_GITHUB_ID", { AUTH_GITHUB_ID: "" }, "development")).toBe("");
    expect(readConfigValue("AUTH_GITHUB_ID", {}, "development")).toBe("missing-github-client-id");
  });

  it("does not enforce production requirements while building or testing", () => {
    expect(() => validateConfig({}, "build")).not.toThrow();
    expect(() => validateConfig({}, "test")).not.toThrow();
  });

  it.each(
    configRegistry.flatMap((entry) => {
      const exampleValue = "exampleValue" in entry ? entry.exampleValue : undefined;
      return entry.requiredIn.some((context) => context === "production") && exampleValue
        ? [[entry.name, exampleValue, entry.group] as const]
        : [];
    }),
  )("rejects the public example for production variable %s", (name, exampleValue, group) => {
    expect(() =>
      validateConfig({ ...validProductionConfig, [name]: exampleValue }, "production"),
    ).toThrow(new RegExp(`${name}.*${group}`, "i"));
  });

  it("resolves build and test before production-like observations", () => {
    expect(
      resolveConfigRuntimeContext({
        NEXT_PHASE: "phase-production-build",
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
    ).toBe("build");
    expect(resolveConfigRuntimeContext({ NODE_ENV: "test", VERCEL_ENV: "production" })).toBe(
      "test",
    );
    expect(resolveConfigRuntimeContext({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveConfigRuntimeContext({ NODE_ENV: "development" })).toBe("development");
  });

  it("keeps platform observations read-only and never required", () => {
    for (const name of ["CI", "NEXT_PHASE", "NEXT_RUNTIME", "NODE_ENV", "VERCEL_ENV"]) {
      const definition = configRegistry.find((entry) => entry.name === name);
      expect(definition, name).toMatchObject({ readOnly: true, requiredIn: [] });
    }
  });

  it("reports all missing production requirements by variable and group without values", () => {
    expect(() => validateConfig({}, "production")).toThrow(
      /AUTH_SECRET \(auth\)[\s\S]*DATABASE_URL \(database\)[\s\S]*GITHUB_WEBHOOK_SECRET \(github\)/,
    );
  });
});
