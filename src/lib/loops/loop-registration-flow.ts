import type { LoopManifestValidationError } from "@/lib/loops/manifest";

import type { LoopDefinition } from "../../../schemas/loop-manifest";
import type { LoopRegistrationInput } from "./loop-registration";
import { validateLoopRegistration } from "./loop-registration";
import type {
  LoopRegistrationOutcome,
  RegisteredLoopDefinition,
  TrackedRepository,
} from "./loop-registration-store";

export type LoopRegistrationFormInput = {
  description?: string;
  enabled: boolean;
  issueLabels: string[];
  key: string;
  name: string;
  repositoryId: string;
};

/**
 * `no-tracked-repositories` is a distinct state, not an empty `ready`: an operator with an
 * installation but no selected repositories must be routed back to selection rather than shown a
 * form they cannot complete (ADR 0019 — an empty state must route to the step it names).
 */
export type LoopRegistrationSnapshot =
  | { reason: string; repositories?: never; status: "error" }
  | { reason?: never; repositories?: never; status: "no-tracked-repositories" }
  | { reason?: never; repositories: TrackedRepository[]; status: "ready" };

export type LoopRegistrationResult =
  | { errors: LoopManifestValidationError[]; loopKey?: never; reason?: never; status: "invalid" }
  | { errors?: never; loopKey: string; reason?: never; status: "registered" }
  | {
      errors?: never;
      loopKey?: never;
      reason?: never;
      status: "duplicate-key" | "repository-missing";
    }
  | { errors?: never; loopKey?: never; reason: string; status: "error" };

export type LoopRegistrationStore = {
  listRegistered(): Promise<RegisteredLoopDefinition[]>;
  listTrackedRepositories(): Promise<TrackedRepository[]>;
  register(input: {
    definition: LoopDefinition;
    now: Date;
    repositoryId: string;
  }): Promise<LoopRegistrationOutcome>;
};

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : "loop_registration_failed";
}

export function createLoopRegistrationFlow(dependencies: {
  now: () => Date;
  store: LoopRegistrationStore;
}) {
  return {
    async readRegistration(): Promise<LoopRegistrationSnapshot> {
      try {
        const repositories = await dependencies.store.listTrackedRepositories();
        return repositories.length === 0
          ? { status: "no-tracked-repositories" }
          : { repositories, status: "ready" };
      } catch (error) {
        return { reason: failureReason(error), status: "error" };
      }
    },

    async registerLoop(input: LoopRegistrationFormInput): Promise<LoopRegistrationResult> {
      try {
        const repositories = await dependencies.store.listTrackedRepositories();
        const repository = repositories.find((entry) => entry.id === input.repositoryId);
        // A repository id the catalog does not know must never reach the composer: the manifest
        // slug would be invented rather than read from a tracked row.
        if (!repository) return { status: "repository-missing" };

        const registrationInput: LoopRegistrationInput = {
          defaultBranch: repository.defaultBranch,
          enabled: input.enabled,
          issueLabels: input.issueLabels,
          key: input.key,
          name: input.name,
          repositoryFullName: repository.fullName,
          ...(input.description === undefined ? {} : { description: input.description }),
        };

        const validation = validateLoopRegistration(registrationInput);
        if (!validation.success) return { errors: validation.errors, status: "invalid" };

        const outcome = await dependencies.store.register({
          definition: validation.definition,
          now: dependencies.now(),
          repositoryId: repository.id,
        });

        return outcome === "registered"
          ? { loopKey: validation.definition.key, status: "registered" }
          : { status: outcome };
      } catch (error) {
        return { reason: failureReason(error), status: "error" };
      }
    },
  };
}
