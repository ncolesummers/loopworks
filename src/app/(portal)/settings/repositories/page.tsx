import Link from "next/link";

import { auth } from "@/auth";

import { RepositorySelectionRefresher } from "@/components/portal/repository-selection-refresher";
import { Button } from "@/components/ui/button";
import {
  type RepositorySelectionAuthorizationSubject,
  readRepositorySelectionAuthorizationSubject,
} from "@/lib/auth/repository-selection-subject";
import { readSuppliedRawConfig } from "@/lib/config/registry";
import { repositorySelectionFixture } from "@/lib/fixtures";
import type { RepositorySelectionSnapshot } from "@/lib/github/repository-selection";
import { createGithubRepositorySelectionRuntime } from "@/lib/github/repository-selection-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { observeGithubRepositorySelectionAuthorization } from "@/lib/observability/repository-selection";
import { isProductionRuntime } from "@/lib/runtime";

function RepositorySelectionSurface({
  fixtureMode = false,
  snapshot,
}: Readonly<{ fixtureMode?: boolean; snapshot: RepositorySelectionSnapshot }>) {
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            GitHub settings
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Repository selection</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Choose which repositories from the connected installation Loopworks tracks. Selected
            repositories populate the catalog.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/settings">Back to GitHub settings</Link>
        </Button>
      </section>

      <RepositorySelectionRefresher fixtureMode={fixtureMode} snapshot={snapshot} />
    </div>
  );
}

export async function RepositorySelectionPageContent({
  env = process.env,
  readAuthorizationSubject,
  readSelection,
}: Readonly<{
  env?: Partial<NodeJS.ProcessEnv>;
  readAuthorizationSubject?: () => Promise<RepositorySelectionAuthorizationSubject | null>;
  readSelection?: (
    subject: RepositorySelectionAuthorizationSubject,
  ) => Promise<RepositorySelectionSnapshot>;
}> = {}) {
  // Explicit, non-production fixture mode only; it must never stand in for a failed real read.
  if (
    !isProductionRuntime(env) &&
    readSuppliedRawConfig("LOOPWORKS_PORTAL_DATA_MODE", env) === "fixtures"
  ) {
    return <RepositorySelectionSurface fixtureMode snapshot={repositorySelectionFixture} />;
  }

  let snapshot: RepositorySelectionSnapshot;
  try {
    const authorizationSubject = await (
      readAuthorizationSubject ??
      (async () => readRepositorySelectionAuthorizationSubject(await auth()))
    )();
    if (!authorizationSubject) {
      observeGithubRepositorySelectionAuthorization({
        cacheHit: false,
        operation: "read",
        outcome: "indeterminate",
      });
      return (
        <RepositorySelectionSurface
          snapshot={{ reason: "repository_selection_unavailable", status: "error" }}
        />
      );
    }
    snapshot = await (
      readSelection ??
      ((subject: RepositorySelectionAuthorizationSubject) =>
        createGithubRepositorySelectionRuntime().readSelection(subject))
    )(authorizationSubject);
  } catch {
    // Configuration and runtime construction failures must not blank the page; the operator still
    // needs the surrounding surface and its route back to installation access.
    createRequestLogger({ route: "portal.settings.repositories" }).warn(
      { reason: "repository_selection_unavailable" },
      "repository_selection_read_failed",
    );
    snapshot = { reason: "repository_selection_unavailable", status: "error" };
  }

  if (snapshot.status === "access-denied") {
    snapshot = { reason: "repository_selection_unavailable", status: "error" };
  }

  return <RepositorySelectionSurface snapshot={snapshot} />;
}

export default async function RepositorySelectionPage() {
  return <RepositorySelectionPageContent />;
}
