import type { Meta, StoryObj } from "@storybook/nextjs";

import { RepositorySelectionView } from "@/components/portal/repository-selection-view";
import type { RepositorySelectionEntry } from "@/lib/github/repository-selection";

const installation = {
  accountLogin: "loopworks-org",
  accountType: "Organization",
  appId: 124,
  installationId: 124_001,
  repositorySelection: "selected",
};

function repository(overrides: Partial<RepositorySelectionEntry>): RepositorySelectionEntry {
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

const repositories = [
  repository({}),
  repository({
    fullName: "loopworks-org/agent",
    githubRepoId: 900_002,
    name: "agent",
    private: false,
    selected: true,
  }),
  repository({
    archived: true,
    fullName: "loopworks-org/legacy-runner",
    githubRepoId: 900_003,
    name: "legacy-runner",
  }),
];

const meta = {
  component: RepositorySelectionView,
  parameters: { layout: "padded" },
  title: "Portal/Settings/RepositorySelection",
} satisfies Meta<typeof RepositorySelectionView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { snapshot: { installation, repositories, status: "ready" } },
};

export const AllSelected: Story = {
  args: {
    snapshot: {
      installation,
      repositories: repositories.map((entry) => ({ ...entry, selected: true })),
      status: "ready",
    },
  },
};

export const AccessRevoked: Story = {
  args: {
    snapshot: {
      installation,
      repositories: [
        repositories[1] as RepositorySelectionEntry,
        repository({ accessible: false, selected: true }),
      ],
      status: "ready",
    },
  },
};

export const Loading: Story = {
  args: { loading: true, snapshot: { installation, repositories: [], status: "ready" } },
};

export const NoAccessibleRepositories: Story = {
  args: { snapshot: { installation, repositories: [], status: "no-accessible-repositories" } },
};

export const AccessFullyRevoked: Story = {
  args: {
    snapshot: {
      installation,
      repositories: [repository({ accessible: false, selected: true })],
      status: "no-accessible-repositories",
    },
  },
};

export const FixtureMode: Story = {
  args: { fixtureMode: true, snapshot: { installation, repositories, status: "ready" } },
};

export const NotConnected: Story = {
  args: { snapshot: { status: "not-connected" } },
};

export const ErrorPanel: Story = {
  args: { snapshot: { reason: "github_repository_verification_failed", status: "error" } },
};
