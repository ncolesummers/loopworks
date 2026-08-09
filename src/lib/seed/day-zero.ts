import { githubInstallations, repositories } from "@/db/schema";
import type { SeedDatabase, SeedTransaction } from "@/lib/seed/demo-data";

/**
 * The day-zero activation fixture (#128, P05/M04/M05).
 *
 * The Playwright walk starts on a database holding none of these rows and advances one stage at a
 * time. Each stage stands in for exactly one thing GitHub owns and this lane cannot reach - an
 * installation, then the repository access that installation grants - so everything the product
 * owns stays driven through its own surfaces. `applyDayZeroRepository` therefore also applies the
 * installation: a tracked repository without one is a state the product can never produce.
 *
 * Every row carries a fixed id in a namespace the demo dataset does not use, so re-applying a
 * stage is idempotent and neither lane can overwrite the other's rows. Getting *back* to day zero
 * is the `reset` stage of `scripts/seed-day-zero.ts`: first-run state is derived from whether any
 * installation or repository row exists at all, so only an empty database produces it, and a
 * destructive reset belongs behind that script's local-database guard rather than here.
 */

export type DayZeroSeedCounts = {
  githubInstallations: number;
  repositories: number;
};

export const dayZeroSeedIds = {
  installationId: 800_000_101,
  /** Namespace `1a`, which `demoSeedIds` never emits. */
  repositoryId: "1a000000-0000-4000-8000-000000000001",
} as const;

export type DayZeroSeedData = {
  installation: typeof githubInstallations.$inferInsert;
  repository: typeof repositories.$inferInsert;
};

export function buildDayZeroSeedData(): DayZeroSeedData {
  const installedAt = new Date("2026-08-09T08:00:00.000Z");

  return {
    installation: {
      accountId: 700_000_101,
      accountLogin: "ncolesummers",
      accountType: "User",
      // Must match the lane's `GITHUB_APP_ID`; `readPortalRecords` filters installations by it, so
      // a mismatch renders the installation stage as if no installation existed at all.
      appId: 800_000,
      installationId: dayZeroSeedIds.installationId,
      installedAt,
      installedBy: "ncolesummers",
      repositorySelection: "selected",
      updatedAt: installedAt,
    },
    repository: {
      ciCommands: ["bun run validate"],
      defaultBranch: "main",
      enabledLoops: [],
      framework: "Next.js",
      fullName: "ncolesummers/loopworks-day-zero",
      githubRepoId: 910_000_101,
      health: "healthy",
      id: dayZeroSeedIds.repositoryId,
      installationId: dayZeroSeedIds.installationId,
      name: "loopworks-day-zero",
      owner: "ncolesummers",
      validationGates: [],
    },
  };
}

async function upsertInstallation(tx: SeedTransaction): Promise<void> {
  const { installation } = buildDayZeroSeedData();
  await tx.insert(githubInstallations).values(installation).onConflictDoUpdate({
    target: githubInstallations.installationId,
    set: installation,
  });
}

/** Stage one: the operator has connected the GitHub App and selected no repository yet. */
export async function applyDayZeroInstallation(database: SeedDatabase): Promise<DayZeroSeedCounts> {
  return database.transaction(async (tx) => {
    await upsertInstallation(tx);
    return { githubInstallations: 1, repositories: 0 };
  });
}

/** Stage two: the installation grants access to one repository, tracked in the catalog. */
export async function applyDayZeroRepository(database: SeedDatabase): Promise<DayZeroSeedCounts> {
  const { repository } = buildDayZeroSeedData();

  return database.transaction(async (tx) => {
    await upsertInstallation(tx);
    await tx.insert(repositories).values(repository).onConflictDoUpdate({
      target: repositories.id,
      set: repository,
    });
    return { githubInstallations: 1, repositories: 1 };
  });
}
