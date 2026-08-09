import type { DayZeroSeedCounts } from "@/lib/seed/day-zero";
import type { SeedDatabase } from "@/lib/seed/demo-data";

import { runDayZeroCli } from "../../../scripts/seed-day-zero";

const fakeDatabase = {} as SeedDatabase;

function stageCounts(): DayZeroSeedCounts {
  return { githubInstallations: 0, repositories: 0 };
}

function dependencies(overrides: Partial<Parameters<typeof runDayZeroCli>[2]> = {}) {
  return {
    applyDayZeroInstallation: vi.fn(async () => stageCounts()),
    applyDayZeroRepository: vi.fn(async () => stageCounts()),
    database: fakeDatabase,
    resetDatabase: vi.fn(async () => {}),
    ...overrides,
  };
}

const localEnv = {
  DATABASE_URL: "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e",
  NODE_ENV: "development",
} as const satisfies Partial<NodeJS.ProcessEnv>;

describe("seed-day-zero CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies the stage the argument names", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = dependencies();

    expect(await runDayZeroCli(["reset"], localEnv, deps)).toBe(0);
    expect(deps.resetDatabase).toHaveBeenCalledTimes(1);

    expect(await runDayZeroCli(["installation"], localEnv, deps)).toBe(0);
    expect(deps.applyDayZeroInstallation).toHaveBeenCalledWith(fakeDatabase);

    expect(await runDayZeroCli(["repository"], localEnv, deps)).toBe(0);
    expect(deps.applyDayZeroRepository).toHaveBeenCalledWith(fakeDatabase);
  });

  it("rejects an unknown stage without touching the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies();

    expect(await runDayZeroCli(["bogus"], localEnv, deps)).toBe(1);
    expect(deps.resetDatabase).not.toHaveBeenCalled();
    expect(deps.applyDayZeroInstallation).not.toHaveBeenCalled();
    expect(deps.applyDayZeroRepository).not.toHaveBeenCalled();
  });

  it("requires exactly one stage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies();

    expect(await runDayZeroCli([], localEnv, deps)).toBe(1);
    expect(await runDayZeroCli(["reset", "installation"], localEnv, deps)).toBe(1);
    expect(deps.resetDatabase).not.toHaveBeenCalled();
  });

  it("refuses to run in production and never touches the database", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies();

    expect(
      await runDayZeroCli(["reset"], { ...localEnv, NODE_ENV: "production" } as const, deps),
    ).toBe(1);
    expect(deps.resetDatabase).not.toHaveBeenCalled();

    const logged = errorSpy.mock.calls.flat().join(" ").toLowerCase();
    expect(logged).not.toContain("postgres://");
  });

  it("refuses a non-loopback host, and never prints the credential it rejected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies();

    const exitCode = await runDayZeroCli(
      ["reset"],
      {
        DATABASE_URL: "postgres://admin:hunter2@prod-db.internal:5432/loopworks_e2e",
        NODE_ENV: "development",
      } as const,
      deps,
    );

    expect(exitCode).toBe(1);
    expect(deps.resetDatabase).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("hunter2");
  });

  it("refuses any database other than the named browser-lane database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies();

    const exitCode = await runDayZeroCli(
      ["reset"],
      {
        DATABASE_URL: "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks",
        NODE_ENV: "development",
      } as const,
      deps,
    );

    expect(exitCode).toBe(1);
    expect(deps.resetDatabase).not.toHaveBeenCalled();
  });

  it("requires an explicit DATABASE_URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies();

    expect(await runDayZeroCli(["reset"], { NODE_ENV: "development" } as const, deps)).toBe(1);
    expect(deps.resetDatabase).not.toHaveBeenCalled();
  });
});
