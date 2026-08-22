import { HttpResponse, http } from "msw";

import { verifyPreviewAlias } from "../../../scripts/verify-preview-alias";
import { mswServer } from "../../helpers/msw";

describe("verify-preview-alias", () => {
  it("accepts a reachable Preview alias, including a Vercel protection redirect", async () => {
    mswServer.use(
      http.get("https://loopworks-preview.vercel.app/", () =>
        HttpResponse.redirect("https://vercel.com/login", 307),
      ),
    );

    await expect(verifyPreviewAlias({ alias: "loopworks-preview.vercel.app" })).resolves.toBe(
      undefined,
    );
  });

  it("accepts a Vercel protection authorization response as reachable", async () => {
    mswServer.use(
      http.get("https://loopworks-preview.vercel.app/", () =>
        HttpResponse.json({ error: "authentication required" }, { status: 401 }),
      ),
    );

    await expect(verifyPreviewAlias({ alias: "loopworks-preview.vercel.app" })).resolves.toBe(
      undefined,
    );
  });

  it("fails closed for an unavailable alias without printing secrets", async () => {
    mswServer.use(
      http.get("https://loopworks-preview.vercel.app/", () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );

    await expect(verifyPreviewAlias({ alias: "loopworks-preview.vercel.app" })).rejects.toThrow(
      /404/,
    );
  });
});
