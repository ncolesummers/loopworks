import { loopManifestSchema } from "../../../schemas/loop-manifest";

import { defaultLoopManifest, parseLoopManifest } from "@/lib/loops/manifest";

describe("loop manifest schema", () => {
  it("parses the default manifest", () => {
    const manifest = parseLoopManifest(defaultLoopManifest);

    expect(manifest.repo).toBe("ncolesummers/loopworks");
    expect(manifest.loopStates).toContain("planned");
    expect(manifest.agentReady.readyLabels).toContain("status:ready");
  });

  it("rejects an invalid repo slug", () => {
    const result = loopManifestSchema.safeParse({
      ...defaultLoopManifest,
      repo: "not a slug",
    });

    expect(result.success).toBe(false);
  });
});
