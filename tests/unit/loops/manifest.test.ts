import { loopManifestSchema } from "../../../schemas/loop-manifest";

import { defaultLoopManifest, parseLoopManifest } from "@/lib/loops/manifest";

describe("loop manifest schema", () => {
  it("parses the default manifest", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    expect(manifest.repo).toBe("ncolesummers/loopworks");
    expect(manifest.loopStates).toContain("planned");
    expect(manifest.agentReady.readyLabels).toContain("status:ready");
  });

  it("maps each MVP milestone and issue to persona-derived acceptance ids", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    for (const milestone of manifest.milestones) {
      expect(milestone.personaTestIds, milestone.name).toEqual(
        expect.arrayContaining([expect.stringMatching(/^[PMARS]\d{2}$/)]),
      );

      for (const issue of milestone.issues) {
        expect(issue.personaTestIds, `${milestone.name} / ${issue.title}`).toEqual(
          expect.arrayContaining([expect.stringMatching(/^[PMARS]\d{2}$/)]),
        );
      }
    }
  });

  it("keeps milestone persona ids as supersets of their issue persona ids", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    for (const milestone of manifest.milestones) {
      const milestoneIds = new Set(milestone.personaTestIds);

      for (const issue of milestone.issues) {
        expect(
          issue.personaTestIds.every((personaTestId) => milestoneIds.has(personaTestId)),
          `${milestone.name} must include all persona ids from ${issue.title}`,
        ).toBe(true);
      }
    }
  });

  it("rejects an invalid repo slug", () => {
    const result = loopManifestSchema.safeParse({
      ...defaultLoopManifest,
      repo: "not a slug",
    });

    expect(result.success).toBe(false);
  });
});
