import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GitHubSettingsView } from "@/components/portal/github-settings-view";
import { RepositorySelectionView } from "@/components/portal/repository-selection-view";
import type {
  RepositorySelectionEntry,
  RepositorySelectionSnapshot,
} from "@/lib/github/repository-selection";

afterEach(cleanup);

const installation = {
  accountLogin: "loopworks-org",
  accountType: "Organization",
  appId: 124,
  installationId: 124_001,
  repositorySelection: "selected",
};

function entry(overrides: Partial<RepositorySelectionEntry> = {}): RepositorySelectionEntry {
  return {
    accessible: true,
    archived: false,
    defaultBranch: "main",
    fullName: "loopworks-org/portal",
    githubRepoId: 900_001,
    name: "portal",
    owner: "loopworks-org",
    private: true,
    selected: false,
    ...overrides,
  };
}

const ready: RepositorySelectionSnapshot = {
  installation,
  repositories: [
    entry(),
    entry({ fullName: "loopworks-org/agent", githubRepoId: 900_002, name: "agent" }),
  ],
  status: "ready",
};

function surface() {
  const region = screen.getByRole("region", { name: "Repository selection" });
  return region;
}

describe("RepositorySelectionView", () => {
  it("distinguishes an installation with zero repositories from no installation at all", () => {
    render(
      <RepositorySelectionView
        snapshot={{ installation, repositories: [], status: "no-accessible-repositories" }}
      />,
    );

    expect(screen.getByText("No repositories reachable")).toBeTruthy();
    const adjust = screen.getByRole("link", { name: /adjust repository access/i });
    expect(adjust.getAttribute("href")).toBe("https://github.com/settings/installations/124001");
    expect(screen.queryByRole("link", { name: /connect github app/i })).toBeNull();

    cleanup();
    render(<RepositorySelectionView snapshot={{ status: "not-connected" }} />);

    expect(screen.getByText("No GitHub App installation connected")).toBeTruthy();
    expect(screen.getByRole("link", { name: /connect github app/i }).getAttribute("href")).toBe(
      "/api/github/install",
    );
    expect(screen.queryByText("No repositories reachable")).toBeNull();
  });

  it("holds the same surface dimensions across loading, empty, and error states", () => {
    const heights: string[] = [];
    for (const snapshot of [
      { status: "ready" as const, installation, repositories: [] },
      { status: "not-connected" as const },
      { status: "error" as const, reason: "unused" },
      ready,
    ]) {
      render(<RepositorySelectionView loading={snapshot === ready} snapshot={snapshot} />);
      heights.push(surface().className);
      cleanup();
    }

    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toContain("min-h-");
  });

  it("marks the loading state busy without collapsing the surface", () => {
    render(<RepositorySelectionView loading snapshot={ready} />);

    expect(surface().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading repositories")).toBeTruthy();
  });

  it("filters the list by search and keeps selection state keyboard-operable", () => {
    render(<RepositorySelectionView snapshot={ready} />);

    const portal = screen.getByRole("checkbox", { name: /loopworks-org\/portal/ });
    expect((portal as HTMLInputElement).checked).toBe(false);
    fireEvent.click(portal);
    expect((portal as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "agent" },
    });
    expect(screen.queryByRole("checkbox", { name: /loopworks-org\/portal/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /loopworks-org\/agent/ })).toBeTruthy();
  });

  it("submits only the repositories whose selection changed", async () => {
    const applySelection = vi.fn(async () => ({
      outcomes: [{ githubRepoId: 900_001, outcome: "selected" as const }],
      status: "applied" as const,
    }));
    render(
      <RepositorySelectionView
        applySelection={applySelection}
        snapshot={{
          installation,
          repositories: [
            entry(),
            entry({
              fullName: "loopworks-org/agent",
              githubRepoId: 900_002,
              name: "agent",
              selected: true,
            }),
          ],
          status: "ready",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    fireEvent.click(screen.getByRole("button", { name: /save selection/i }));

    await waitFor(() => {
      expect(applySelection).toHaveBeenCalledWith({ deselect: [], select: [900_001] });
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("1 repository selected");
    });
  });

  it("renders the zero-access state even when revoked selections remain", () => {
    render(
      <RepositorySelectionView
        snapshot={{
          installation,
          repositories: [entry({ accessible: false, selected: true })],
          status: "no-accessible-repositories",
        }}
      />,
    );

    expect(screen.getByText("No repositories reachable")).toBeTruthy();
    expect(screen.getByRole("link", { name: /adjust repository access/i })).toBeTruthy();
    // The revoked selection still has to be actionable, or it can never be removed.
    expect(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ })).toBeTruthy();
  });

  it("does not present a repository with revoked access as public", () => {
    render(
      <RepositorySelectionView
        snapshot={{
          installation,
          repositories: [entry({ accessible: false, private: false, selected: true })],
          status: "ready",
        }}
      />,
    );

    expect(screen.getByText("Access revoked")).toBeTruthy();
    expect(screen.queryByText("Private")).toBeNull();
    expect(screen.queryByText("Public")).toBeNull();
  });

  it("rebases the baseline after a successful save so the same change cannot be replayed", async () => {
    const applySelection = vi.fn(async () => ({
      outcomes: [{ githubRepoId: 900_001, outcome: "selected" as const }],
      status: "applied" as const,
    }));
    render(<RepositorySelectionView applySelection={applySelection} snapshot={ready} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    const save = screen.getByRole("button", { name: /save selection/i }) as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() => expect(save.disabled).toBe(true));
    expect(applySelection).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("restores the checkbox when the server refuses a deselection", async () => {
    render(
      <RepositorySelectionView
        applySelection={async () => ({
          outcomes: [{ githubRepoId: 900_001, outcome: "in-use" as const }],
          status: "applied" as const,
        })}
        snapshot={{ installation, repositories: [entry({ selected: true })], status: "ready" }}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /loopworks-org\/portal/,
    }) as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /save selection/i }));

    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(
      (screen.getByRole("button", { name: /save selection/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("counts a successful removal as removed, not as a refusal", async () => {
    render(
      <RepositorySelectionView
        applySelection={async () => ({
          outcomes: [{ githubRepoId: 900_001, outcome: "deselected" as const }],
          status: "applied" as const,
        })}
        snapshot={{ installation, repositories: [entry({ selected: true })], status: "ready" }}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    fireEvent.click(screen.getByRole("button", { name: /save selection/i }));

    await waitFor(() => {
      const status = screen.getByRole("status").textContent ?? "";
      expect(status).toContain("1 repository removed");
      expect(status).not.toContain("still has loop or run history");
    });
  });

  it("surfaces committed writes when the server reports a partial save", async () => {
    render(
      <RepositorySelectionView
        applySelection={async () => ({
          outcomes: [{ githubRepoId: 900_001, outcome: "selected" as const }],
          reason: "unused",
          status: "partial" as const,
        })}
        snapshot={ready}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    fireEvent.click(screen.getByRole("button", { name: /save selection/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Some changes were not saved");
    });
  });

  it("reports a network failure instead of silently re-enabling the save action", async () => {
    render(
      <RepositorySelectionView
        applySelection={async () => {
          throw new Error("offline");
        }}
        snapshot={ready}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    fireEvent.click(screen.getByRole("button", { name: /save selection/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("could not be saved");
    });
  });

  it("explains that saving is unavailable in fixture mode instead of posting fixture ids", () => {
    render(<RepositorySelectionView fixtureMode snapshot={ready} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    expect(
      (screen.getByRole("button", { name: /save selection/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("reports a refused deselection instead of claiming success", async () => {
    const applySelection = vi.fn(async () => ({
      outcomes: [{ githubRepoId: 900_001, outcome: "in-use" as const }],
      status: "applied" as const,
    }));
    render(
      <RepositorySelectionView
        applySelection={applySelection}
        snapshot={{
          installation,
          repositories: [entry({ selected: true })],
          status: "ready",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    fireEvent.click(screen.getByRole("button", { name: /save selection/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("still has loop or run history");
    });
  });

  it("shows a repository the installation can no longer reach as revoked", () => {
    render(
      <RepositorySelectionView
        snapshot={{
          installation,
          repositories: [entry({ accessible: false, selected: true })],
          status: "ready",
        }}
      />,
    );

    expect(screen.getByText("Access revoked")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("surfaces an upstream failure without a bare empty list", () => {
    render(<RepositorySelectionView snapshot={{ reason: "unused", status: "error" }} />);

    expect(screen.getByText("Repository list unavailable")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("routes an operator from a connected installation to repository selection", () => {
    render(
      <GitHubSettingsView
        githubInstallations={[
          {
            accountLogin: "loopworks-org",
            accountType: "Organization",
            installationId: 124_001,
            repositorySelection: "selected",
          },
        ]}
        settings={[{ detail: "Authenticated.", enabled: true, key: "sso", title: "GitHub SSO" }]}
        sourceLabel="Live database"
      />,
    );

    expect(screen.getByRole("link", { name: /select repositories/i }).getAttribute("href")).toBe(
      "/settings/repositories",
    );
  });

  it("keeps the save action disabled until a selection actually changes", () => {
    render(<RepositorySelectionView snapshot={ready} />);

    const save = screen.getByRole("button", { name: /save selection/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ }));
    expect(save.disabled).toBe(false);
  });
});
