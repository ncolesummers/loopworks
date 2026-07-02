import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

describe("isProductionRuntime", () => {
  it("returns true when NODE_ENV is production", () => {
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
  });

  it("returns true when VERCEL_ENV is production, even if NODE_ENV is not", () => {
    expect(isProductionRuntime({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(true);
  });

  it("treats a Vercel preview build as production, since Next.js sets NODE_ENV=production for every optimized build", () => {
    // This is a documented, intentional over-block: Vercel preview deployments
    // build with `next build`, which sets NODE_ENV=production regardless of
    // VERCEL_ENV. Callers relying on this helper (FixtureGatedPage, the
    // Vercel deployment client, auth bypass, webhook bypass) all fail closed
    // on preview too, not just on true production - the safe direction.
    expect(isProductionRuntime({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("returns false for development", () => {
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
  });

  it("returns false for the Vitest test environment", () => {
    expect(isProductionRuntime({ NODE_ENV: "test" })).toBe(false);
  });

  it("returns false when neither variable is set", () => {
    expect(isProductionRuntime({})).toBe(false);
  });

  it("returns false for values that merely contain the word production", () => {
    expect(
      isProductionRuntime({ NODE_ENV: "pre-production" as NodeJS.ProcessEnv["NODE_ENV"] }),
    ).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "Production" as NodeJS.ProcessEnv["NODE_ENV"] })).toBe(
      false,
    );
  });

  it("defaults to process.env when no env is passed", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");

    expect(isProductionRuntime()).toBe(true);

    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  });
});

describe("isTruthyEnvValue", () => {
  it("treats common truthy strings as true, case-insensitively", () => {
    expect(isTruthyEnvValue("1")).toBe(true);
    expect(isTruthyEnvValue("true")).toBe(true);
    expect(isTruthyEnvValue("TRUE")).toBe(true);
    expect(isTruthyEnvValue("yes")).toBe(true);
    expect(isTruthyEnvValue("on")).toBe(true);
    expect(isTruthyEnvValue("  true  ")).toBe(true);
  });

  it("treats everything else, including undefined, as false", () => {
    expect(isTruthyEnvValue("0")).toBe(false);
    expect(isTruthyEnvValue("false")).toBe(false);
    expect(isTruthyEnvValue("")).toBe(false);
    expect(isTruthyEnvValue(undefined)).toBe(false);
  });
});
