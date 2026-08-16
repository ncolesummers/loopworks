import type { RepositorySelectionAuthorizationSubject } from "@/lib/auth/repository-selection-subject";
import type { AvailableGithubRepository } from "@/lib/github/installation-flow";
import type { RepositorySelectionAuthorizationDecision } from "@/lib/github/repository-selection-authorization";
import type {
  RepositoryDeselectionOutcome,
  RepositorySelectionInput,
  RepositorySelectionOutcome,
} from "@/lib/github/repository-selection-store";
import { observeGithubRepositorySelectionAuthorization } from "@/lib/observability/repository-selection";

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
  | { installation?: never; reason?: never; repositories?: never; status: "access-denied" }
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
  | { outcomes?: never; reason?: never; status: "access-denied" }
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

const safeFailureReasons = new Set([
  "github_installation_token_failed",
  "github_repository_selection_failed",
  "github_repository_verification_failed",
]);

function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return safeFailureReasons.has(message) ? message : "github_repository_selection_failed";
}

export function createGithubRepositorySelectionFlow(dependencies: {
  authorizeInstallationAccess(
    subject: RepositorySelectionAuthorizationSubject,
    installation: ConnectedGithubInstallation,
  ): Promise<RepositorySelectionAuthorizationDecision>;
  gateway: GithubRepositorySelectionGateway;
  now: () => Date;
  observeAuthorizationOutcome?: (input: {
    cacheHit: boolean;
    operation: "apply" | "read";
    outcome: RepositorySelectionAuthorizationDecision["outcome"];
  }) => void;
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

  async function authorize(
    operation: "apply" | "read",
    subject: RepositorySelectionAuthorizationSubject,
    installation: ConnectedGithubInstallation,
  ): Promise<RepositorySelectionAuthorizationDecision> {
    let decision: RepositorySelectionAuthorizationDecision;
    try {
      decision = await dependencies.authorizeInstallationAccess(subject, installation);
    } catch {
      decision = { cacheHit: false, outcome: "indeterminate" };
    }
    try {
      (dependencies.observeAuthorizationOutcome ?? observeGithubRepositorySelectionAuthorization)({
        cacheHit: decision.cacheHit,
        operation,
        outcome: decision.outcome,
      });
    } catch {
      // Authorization must not depend on telemetry sink health.
    }
    return decision;
  }

  return {
    async readSelection(
      subject: RepositorySelectionAuthorizationSubject,
    ): Promise<RepositorySelectionSnapshot> {
      const installation = await resolveInstallation();
      if (!installation) return { status: "not-connected" };

      const decision = await authorize("read", subject, installation);
      if (decision.outcome === "access-denied") return { status: "access-denied" };
      if (decision.outcome === "indeterminate") {
        return {
          reason: "github_repository_selection_authorization_indeterminate",
          status: "error",
        };
      }

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

    async applySelection(
      subject: RepositorySelectionAuthorizationSubject,
      input: {
        deselect: number[];
        select: number[];
      },
    ): Promise<RepositorySelectionApplyResult> {
      const installation = await resolveInstallation();
      if (!installation) return { status: "not-connected" };

      const decision = await authorize("apply", subject, installation);
      if (decision.outcome === "access-denied") return { status: "access-denied" };
      if (decision.outcome === "indeterminate") {
        return {
          reason: "github_repository_selection_authorization_indeterminate",
          status: "error",
        };
      }

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
