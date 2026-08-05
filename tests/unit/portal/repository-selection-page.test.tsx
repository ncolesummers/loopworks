import { cleanup, render, screen } from "@testing-library/react";

import { RepositorySelectionPageContent } from "@/app/(portal)/settings/repositories/page";

// The page renders a client component that refreshes the server read after a save; jsdom has no
// mounted app router.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(cleanup);

describe("repository selection page", () => {
  it("renders the not-connected state when the read succeeds with no installation", async () => {
    render(
      await RepositorySelectionPageContent({
        readSelection: async () => ({ status: "not-connected" }),
      }),
    );

    expect(screen.getByText("No GitHub App installation connected")).toBeTruthy();
  });

  it("renders the reachable repositories for a connected installation", async () => {
    render(
      await RepositorySelectionPageContent({
        readSelection: async () => ({
          installation: {
            accountLogin: "loopworks-org",
            accountType: "Organization",
            appId: 124,
            installationId: 124_001,
            repositorySelection: "selected",
          },
          repositories: [
            {
              accessible: true,
              archived: false,
              defaultBranch: "main",
              fullName: "loopworks-org/portal",
              githubRepoId: 900_001,
              name: "portal",
              owner: "loopworks-org",
              private: true,
              selected: false,
            },
          ],
          status: "ready",
        }),
      }),
    );

    expect(screen.getByRole("checkbox", { name: /loopworks-org\/portal/ })).toBeTruthy();
  });

  it("renders the fixture selection surface in explicit fixture mode without touching GitHub", async () => {
    const readSelection = vi.fn();
    render(
      await RepositorySelectionPageContent({
        env: { LOOPWORKS_PORTAL_DATA_MODE: "fixtures", NODE_ENV: "development" },
        readSelection,
      }),
    );

    expect(readSelection).not.toHaveBeenCalled();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("never serves the fixture surface in production", async () => {
    render(
      await RepositorySelectionPageContent({
        env: { LOOPWORKS_PORTAL_DATA_MODE: "fixtures", NODE_ENV: "production" },
        readSelection: async () => ({ status: "not-connected" }),
      }),
    );

    expect(screen.getByText("No GitHub App installation connected")).toBeTruthy();
  });

  it("renders the error state when the selection runtime is unavailable", async () => {
    render(
      await RepositorySelectionPageContent({
        readSelection: async () => {
          throw new Error("github_installation_configuration_invalid");
        },
      }),
    );

    expect(screen.getByText("Repository list unavailable")).toBeTruthy();
  });
});
