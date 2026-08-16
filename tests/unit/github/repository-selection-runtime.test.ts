/** @vitest-environment node */

const runtimeHarness = vi.hoisted(() => ({
  cacheOptions: undefined as
    | {
        now: () => number;
        ttlMs: number;
      }
    | undefined,
}));

vi.mock("@/lib/github/repository-selection-authorization", async (importOriginal) => {
  const authorization =
    await importOriginal<typeof import("@/lib/github/repository-selection-authorization")>();
  return {
    ...authorization,
    createRepositorySelectionAuthorizationCache: vi.fn((options) => {
      runtimeHarness.cacheOptions = options;
      return authorization.createRepositorySelectionAuthorizationCache(options);
    }),
  };
});

describe("repository selection runtime authorization cache", () => {
  it("wires the 60-second production cache to a wall-clock-independent clock", async () => {
    await import("@/lib/github/repository-selection-runtime");

    expect(runtimeHarness.cacheOptions?.ttlMs).toBe(60_000);
    const monotonicNow = runtimeHarness.cacheOptions?.now;
    expect(monotonicNow).toBeTypeOf("function");

    const beforeRollback = monotonicNow?.() ?? Number.POSITIVE_INFINITY;
    vi.spyOn(Date, "now").mockReturnValue(-1_000_000_000_000);
    const afterRollback = monotonicNow?.() ?? Number.NEGATIVE_INFINITY;

    expect(afterRollback).toBeGreaterThanOrEqual(beforeRollback);
  });
});
