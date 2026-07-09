import { getSafeExternalHref } from "@/components/portal/safe-url";

describe("portal safe external URLs", () => {
  it("allows expected GitHub, Vercel, and local preview URLs", () => {
    expect(getSafeExternalHref("https://github.com/ncolesummers/loopworks/actions")).toBe(
      "https://github.com/ncolesummers/loopworks/actions",
    );
    expect(getSafeExternalHref("https://loopworks-git-codex-m1-shell.vercel.app")).toBe(
      "https://loopworks-git-codex-m1-shell.vercel.app/",
    );
    expect(getSafeExternalHref("http://localhost:3000/preview")).toBe(
      "http://localhost:3000/preview",
    );
    expect(getSafeExternalHref("artifact://validation/format.log")).toBe(
      "artifact://validation/format.log",
    );
  });

  it("rejects pending, malformed, dangerous, and unexpected external URLs", () => {
    expect(getSafeExternalHref("pending")).toBeNull();
    expect(getSafeExternalHref("javascript:alert(1)")).toBeNull();
    expect(getSafeExternalHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(getSafeExternalHref("https://attacker.example/loopworks")).toBeNull();
    expect(getSafeExternalHref("artifact://other/format.log")).toBeNull();
  });
});
