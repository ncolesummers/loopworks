import { personaJourneyRegistry } from "@/lib/personas/journey-registry";

it.each([
  ["A02", /test-writing.ts/],
  ["S05", /journeySessionSchema/],
] as const)("keeps %s deferred only for the remaining blockers", (scenarioId, remaining) => {
  const entry = personaJourneyRegistry.coverage.find((entry) => entry.scenarioId === scenarioId);
  expect(entry?.kind).toBe("deferred");
  if (entry?.kind !== "deferred") throw new Error("Expected a documented deferral");
  expect(entry.reason).toMatch(remaining);
  expect(entry.reason).not.toMatch(
    /returns the single|without writing|waits on an approval write path/,
  );
  expect(entry.trackedBy).toBe("#266");
});

it("F5 cites both partial A02 browser specs and existing exact-plan enforcement", () => {
  const a02 = personaJourneyRegistry.coverage.find((entry) => entry.scenarioId === "A02");
  if (a02?.kind !== "deferred") throw new Error("Expected deferral");
  expect(a02.reason).toContain("tests/e2e/seeded-postgres.spec.ts");
  expect(a02.reason).toContain("tests/e2e/portal.spec.ts");
  expect(a02.reason).not.toMatch(/enforcement.*unbuilt/);
});
