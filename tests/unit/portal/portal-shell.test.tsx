import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { PortalShell } from "@/components/portal/portal-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
}));

describe("PortalShell", () => {
  it("uses durable semantic icons for Settings and GitHub SSO", () => {
    render(
      <PortalShell user={{ name: "Ada Lovelace", githubLogin: "ada", mode: "github" }}>
        <div>Workspace</div>
      </PortalShell>,
    );

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink.querySelector(".lucide-settings-2")).not.toBeNull();

    const ssoLabel = screen.getByText("GitHub SSO");
    expect(ssoLabel.querySelector(".lucide-key-round")).not.toBeNull();
  });
});
