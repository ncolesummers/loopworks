"use client";

import { useRouter } from "next/navigation";

import { RepositorySelectionView } from "@/components/portal/repository-selection-view";
import type { RepositorySelectionSnapshot } from "@/lib/github/repository-selection";

/**
 * The selection surface is rendered from a server read, so a save leaves the Router Cache holding
 * the pre-save catalog. This refreshes the server components after every applied change.
 */
export function RepositorySelectionRefresher({
  fixtureMode = false,
  snapshot,
}: Readonly<{ fixtureMode?: boolean; snapshot: RepositorySelectionSnapshot }>) {
  const router = useRouter();

  return (
    <RepositorySelectionView
      fixtureMode={fixtureMode}
      onApplied={() => router.refresh()}
      snapshot={snapshot}
    />
  );
}
