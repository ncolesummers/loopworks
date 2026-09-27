import { personaJourneyRegistry } from "@/lib/personas/journey-registry";

it.each(["A02", "S05"] as const)("tracks the remaining %s journey in #266", (scenarioId) => {
  const entry = personaJourneyRegistry.coverage.find((entry) => entry.scenarioId === scenarioId);
  expect(entry?.kind).toBe("deferred");
  if (entry?.kind !== "deferred") throw new Error("Expected a documented deferral");
  expect(entry.trackedBy).toBe("#266");
});
