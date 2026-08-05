import type { AvailableGithubRepository } from "@/lib/github/installation-flow";
import type {
  RepositoryDeselectionOutcome,
  RepositorySelectionInput,
  RepositorySelectionOutcome,
} from "@/lib/github/repository-selection-store";

export type ConnectedGithubInstallation = {
  accountLogin: string;
  accountType: string;
  appId: number;
  installationId: number;
  repositorySelection: string;
};

export type RepositorySelectionEntry = AvailableGithubRepository & {
  /** False when the repository is persisted but the installation no longer reaches it. */
  accessible: boolean;
  selected: boolean;
};

export type RepositorySelectionSnapshot =
  | { installation?: never; reason: string; repositories?: never; status: "error" }
  | { installation?: never; reason?: never; repositories?: never; status: "not-connected" }
  | {
      installation: ConnectedGithubInstallation;
      reason?: never;
      repositories: RepositorySelectionEntry[];
      status: "no-accessible-repositories" | "ready";
    };

export type RepositorySelectionApplyOutcome =
  | RepositoryDeselectionOutcome
  | RepositorySelectionOutcome
  | "not-accessible";

export type RepositorySelectionApplyEntry = {
  githubRepoId: number;
  outcome: RepositorySelectionApplyOutcome;
};

/**
 * `partial` exists because the batch is not one transaction: when a later write fails, the earlier
 * writes are already committed. Reporting them is what makes a retry safe — a bare error would tell
 * the operator nothing changed while rows had in fact been written.
 */
export type RepositorySelectionApplyResult =
  | { outcomes: RepositorySelectionApplyEntry[]; reason?: never; status: "applied" }
  | { outcomes: RepositorySelectionApplyEntry[]; reason: string; status: "partial" }
  | { outcomes?: never; reason: string; status: "error" }
  | { outcomes?: never; reason?: never; status: "not-connected" };

/** The persisted projection of a selection; identity fields are optional so older rows still map. */
export type PersistedRepositorySelection = {
  defaultBranch?: string | null;
  fullName?: string | null;
  githubRepoId: number;
  name?: string | null;
  owner?: string | null;
};

export type GithubRepositorySelectionStore = {
  deselect(input: {
    githubRepoId: number;
    installationId: number;
  }): Promise<RepositoryDeselectionOutcome>;
  listInstallations(): Promise<ConnectedGithubInstallation[]>;
  listSelected(installationId: number): Promise<PersistedRepositorySelection[]>;
  select(input: RepositorySelectionInput): Promise<RepositorySelectionOutcome>;
};

export type GithubRepositorySelectionGateway = {
  listInstallationRepositories(installationId: number): Promise<AvailableGithubRepository[]>;
};

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : "github_repository_selection_failed";
}

export function createGithubRepositorySelectionFlow(dependencies: {
  gateway: GithubRepositorySelectionGateway;
  now: () => Date;
  store: GithubRepositorySelectionStore;
}) {
  async function resolveInstallation() {
    const [installation] = await dependencies.store.listInstallations();
    return installation ?? null;
  }

  async function loadEntries(installation: ConnectedGithubInstallation) {
    const [available, selected] = await Promise.all([
      dependencies.gateway.listInstallationRepositories(installation.installationId),
      dependencies.store.listSelected(installation.installationId),
    ]);
    const selectedIds = new Set(selected.map((repository) => repository.githubRepoId));
    const accessibleIds = new Set(available.map((repository) => repository.githubRepoId));
    const entries: RepositorySelectionEntry[] = available.map((repository) => ({
      ...repository,
      accessible: true,
      selected: selectedIds.has(repository.githubRepoId),
    }));

    // A selection the installation no longer reaches stays visible so the operator can act on it
    // rather than finding a catalog entry with no corresponding row in this surface.
    for (const repository of selected) {
      if (accessibleIds.has(repository.githubRepoId)) continue;
      entries.push({
        accessible: false,
        archived: false,
        defaultBranch: repository.defaultBranch ?? "",
        fullName: repository.fullName ?? "",
        githubRepoId: repository.githubRepoId,
        name: repository.name ?? "",
        owner: repository.owner ?? "",
        private: false,
        selected: true,
      });
    }

    entries.sort((left, right) => left.fullName.localeCompare(right.fullName));
    return { available, entries };
  }

  return {
    async readSelection(): Promise<RepositorySelectionSnapshot> {
      const installation = await resolveInstallation();
      if (!installation) return { status: "not-connected" };

      try {
        const { available, entries } = await loadEntries(installation);
        return {
          installation,
          repositories: entries,
          status: available.length === 0 ? "no-accessible-repositories" : "ready",
        };
      } catch (error) {
        return { reason: failureReason(error), status: "error" };
      }
    },

    async applySelection(input: {
      deselect: number[];
      select: number[];
    }): Promise<RepositorySelectionApplyResult> {
      const installation = await resolveInstallation();
      if (!installation) return { status: "not-connected" };

      const outcomes: RepositorySelectionApplyEntry[] = [];
      try {
        const available = await dependencies.gateway.listInstallationRepositories(
          installation.installationId,
        );
        const availableById = new Map(
          available.map((repository) => [repository.githubRepoId, repository]),
        );
        const now = dependencies.now();

        for (const githubRepoId of input.select) {
          const repository = availableById.get(githubRepoId);
          if (!repository) {
            outcomes.push({ githubRepoId, outcome: "not-accessible" });
            continue;
          }
          outcomes.push({
            githubRepoId,
            outcome: await dependencies.store.select({
              defaultBranch: repository.defaultBranch,
              fullName: repository.fullName,
              githubRepoId,
              installationId: installation.installationId,
              name: repository.name,
              now,
              owner: repository.owner,
            }),
          });
        }

        for (const githubRepoId of input.deselect) {
          outcomes.push({
            githubRepoId,
            outcome: await dependencies.store.deselect({
              githubRepoId,
              installationId: installation.installationId,
            }),
          });
        }

        return { outcomes, status: "applied" };
      } catch (error) {
        // Anything already in `outcomes` is committed; surfacing it is what makes a retry safe.
        return outcomes.length > 0
          ? { outcomes, reason: failureReason(error), status: "partial" }
          : { reason: failureReason(error), status: "error" };
      }
    },
  };
}
