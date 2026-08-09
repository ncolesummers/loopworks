"use client";

import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { type PortalEmptyStateId, portalEmptyState } from "@/components/portal/empty-states";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Status } from "@/components/ui/status-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  RepositorySelectionApplyOutcome,
  RepositorySelectionApplyResult,
  RepositorySelectionEntry,
  RepositorySelectionSnapshot,
} from "@/lib/github/repository-selection";

/** Keeps the surface the same height across loading, empty, error, and populated states. */
const surfaceClassName = "min-h-[24rem] rounded-md border p-6";

const outcomeCopy: Record<RepositorySelectionApplyOutcome, string> = {
  "already-selected": "was already selected",
  deselected: "removed from the catalog",
  "in-use": "kept: it still has loop or run history",
  "name-conflict": "skipped: another tracked repository already uses that name",
  "not-accessible": "skipped: the installation cannot reach it",
  "not-selected": "was not selected",
  "owned-by-other-installation": "skipped: another installation already tracks it",
  selected: "added to the catalog",
};

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function postSelection(input: {
  deselect: number[];
  select: number[];
}): Promise<RepositorySelectionApplyResult> {
  const response = await fetch("/api/github/repositories", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  // 409 (not-connected) and 207 (partial) both carry a body the operator needs; keying only on
  // `response.ok` would collapse them into a generic failure.
  let payload: Partial<RepositorySelectionApplyResult> | null = null;
  try {
    payload = (await response.json()) as Partial<RepositorySelectionApplyResult>;
  } catch {
    payload = null;
  }
  if (payload?.status === "not-connected") return { status: "not-connected" };
  if (payload?.status === "applied" || payload?.status === "partial") {
    return {
      outcomes: payload.outcomes ?? [],
      ...(payload.status === "partial" ? { reason: "partial", status: "partial" as const } : {}),
      status: payload.status,
    } as RepositorySelectionApplyResult;
  }
  return { reason: `http_${response.status}`, status: "error" };
}

function SurfaceState({
  action,
  busy = false,
  detail,
  emptyStateId,
  status,
  title,
}: Readonly<{
  action?: React.ReactNode;
  busy?: boolean;
  detail: string;
  /** Set for zero-data states so the empty-state inventory can find them. */
  emptyStateId?: PortalEmptyStateId;
  status: Status;
  title: string;
}>) {
  return (
    <section
      className={surfaceClassName}
      aria-busy={busy}
      aria-label="Repository selection"
      data-empty-state={emptyStateId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{detail}</p>
      {busy ? (
        <div className="mt-4 grid gap-2" aria-hidden="true">
          <div className="h-3 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-4/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

function matchesSearch(repository: RepositorySelectionEntry, query: string) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return [repository.fullName, repository.owner, repository.name, repository.defaultBranch].some(
    (value) => value.toLowerCase().includes(normalized),
  );
}

function selectedIdsOf(repositories: RepositorySelectionEntry[]): Set<number> {
  return new Set(
    repositories
      .filter((repository) => repository.selected)
      .map((repository) => repository.githubRepoId),
  );
}

export function RepositorySelectionView({
  applySelection = postSelection,
  fixtureMode = false,
  loading = false,
  onApplied,
  snapshot,
}: Readonly<{
  applySelection?: (input: {
    deselect: number[];
    select: number[];
  }) => Promise<RepositorySelectionApplyResult>;
  /** Fixture data carries ids GitHub does not know, so saving is disabled rather than attempted. */
  fixtureMode?: boolean;
  loading?: boolean;
  onApplied?: () => void;
  snapshot: RepositorySelectionSnapshot;
}>) {
  const repositories = useMemo(() => snapshot.repositories ?? [], [snapshot.repositories]);
  const snapshotBaseline = useMemo(() => selectedIdsOf(repositories), [repositories]);
  // Both the baseline and the working set are state so a save can rebase them from the server's
  // outcomes; a `useState` initializer alone would freeze them at mount.
  const [baseline, setBaseline] = useState(snapshotBaseline);
  const [selected, setSelected] = useState(snapshotBaseline);
  const [renderedSnapshot, setRenderedSnapshot] = useState(repositories);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A new snapshot from the server replaces local state; keeping it would diff against a baseline
  // the operator never saw.
  if (renderedSnapshot !== repositories) {
    setRenderedSnapshot(repositories);
    setBaseline(snapshotBaseline);
    setSelected(snapshotBaseline);
  }

  const changes = useMemo(() => {
    const select: number[] = [];
    const deselect: number[] = [];
    for (const repository of repositories) {
      const isSelected = selected.has(repository.githubRepoId);
      if (isSelected && !baseline.has(repository.githubRepoId)) {
        select.push(repository.githubRepoId);
      }
      if (!isSelected && baseline.has(repository.githubRepoId)) {
        deselect.push(repository.githubRepoId);
      }
    }
    return { deselect, select };
  }, [baseline, repositories, selected]);

  const visible = useMemo(
    () => repositories.filter((repository) => matchesSearch(repository, searchQuery)),
    [repositories, searchQuery],
  );

  if (loading) {
    return (
      <SurfaceState
        busy
        detail="Repositories reachable from the connected installation are being listed."
        status="loading"
        title="Loading repositories"
      />
    );
  }

  if (snapshot.status === "error") {
    return (
      <SurfaceState
        detail="The repository list could not be read from GitHub. Retry, or confirm the installation is still active."
        status="failed"
        title="Repository list unavailable"
      />
    );
  }

  if (snapshot.status === "not-connected") {
    const spec = portalEmptyState("repository-selection-not-connected");

    return (
      <SurfaceState
        action={
          // GitHub dead-ends the install link when the account already has the
          // App, so this surface offers the reconciliation route too (#151).
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <a href="/api/github/install">Connect GitHub App</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/api/github/install/reconcile">Find existing installation</a>
            </Button>
          </div>
        }
        detail={spec.detail}
        emptyStateId="repository-selection-not-connected"
        status={spec.status}
        title={spec.title}
      />
    );
  }

  const installationHref = getSafeExternalHref(
    `https://github.com/settings/installations/${snapshot.installation.installationId}`,
  );
  const noAccessSpec = portalEmptyState("repository-selection-no-access");
  const installationAction = installationHref ? (
    <Button asChild variant="outline" className="gap-2">
      <a href={installationHref} target="_blank" rel="noreferrer">
        <ExternalLink className="h-4 w-4" />
        {noAccessSpec.action?.label}
      </a>
    </Button>
  ) : undefined;

  const zeroAccess = snapshot.status === "no-accessible-repositories";

  if (zeroAccess && repositories.length === 0) {
    return (
      <SurfaceState
        action={installationAction}
        detail={`The ${snapshot.installation.accountLogin} installation is connected but grants access to no repositories. Grant it access to at least one repository, then reload this page.`}
        emptyStateId="repository-selection-no-access"
        status={noAccessSpec.status}
        title={noAccessSpec.title}
      />
    );
  }

  async function save() {
    setSaving(true);
    try {
      const result = await applySelection(changes);
      if (result.status === "not-connected") {
        setMessage("No GitHub App installation is connected. Connect one and try again.");
        return;
      }
      if (result.status === "error") {
        setMessage("The selection could not be saved. Try again.");
        return;
      }

      // Rebase from what the server actually did, so a refusal restores its checkbox and an
      // applied change cannot be replayed.
      const next = new Set(baseline);
      for (const entry of result.outcomes) {
        if (entry.outcome === "selected" || entry.outcome === "already-selected") {
          next.add(entry.githubRepoId);
        }
        if (entry.outcome === "deselected" || entry.outcome === "not-selected") {
          next.delete(entry.githubRepoId);
        }
      }
      setBaseline(next);
      setSelected(next);

      const added = result.outcomes.filter(
        (entry) => entry.outcome === "selected" || entry.outcome === "already-selected",
      ).length;
      const removed = result.outcomes.filter((entry) => entry.outcome === "deselected").length;
      const refused = result.outcomes.filter(
        (entry) =>
          entry.outcome !== "selected" &&
          entry.outcome !== "already-selected" &&
          entry.outcome !== "deselected",
      );
      const detail = refused
        .map((entry) => {
          const repository = repositories.find(
            (candidate) => candidate.githubRepoId === entry.githubRepoId,
          );
          return `${repository?.fullName ?? entry.githubRepoId} ${outcomeCopy[entry.outcome]}`;
        })
        .join("; ");
      setMessage(
        [
          `${pluralize(added, "repository", "repositories")} selected, ${pluralize(removed, "repository", "repositories")} removed.`,
          detail.length > 0 ? detail : null,
          result.status === "partial"
            ? "Some changes were not saved. Review the list and retry the rest."
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      onApplied?.();
    } catch {
      // A rejected fetch must not leave the operator with a silently re-enabled button.
      setMessage("The selection could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={surfaceClassName} aria-label="Repository selection">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {zeroAccess
              ? "No repositories reachable"
              : `Repositories in ${snapshot.installation.accountLogin}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {zeroAccess
              ? `The ${snapshot.installation.accountLogin} installation no longer reaches any repository. The selections below are listed so they can be removed.`
              : "Selected repositories appear in the catalog. Deselecting removes a repository that has no loop or run history."}
          </p>
        </div>
        <span className="inline-flex h-6 items-center rounded-md border bg-background px-2 text-xs font-medium">
          {pluralize(selected.size, "repository", "repositories")} selected
        </span>
      </div>

      {zeroAccess && installationAction ? <div className="mt-4">{installationAction}</div> : null}

      {fixtureMode ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This surface is showing fixture data, so saving is disabled.
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        <Label htmlFor="repository-selection-search">Search repositories</Label>
        <Input
          id="repository-selection-search"
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Owner, repository, or default branch"
          value={searchQuery}
        />
      </div>

      {message ? (
        <div className="mt-4 rounded-md border bg-muted/40 px-4 py-3 text-sm" role="status">
          {message}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No repositories match the current search.
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {visible.map((repository) => (
            <li className="flex items-center gap-3 px-4 py-3" key={repository.githubRepoId}>
              <input
                checked={selected.has(repository.githubRepoId)}
                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                id={`repository-${repository.githubRepoId}`}
                onChange={(event) => {
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(repository.githubRepoId);
                    else next.delete(repository.githubRepoId);
                    return next;
                  });
                }}
                type="checkbox"
              />
              <Label
                className="flex-1 cursor-pointer font-normal"
                htmlFor={`repository-${repository.githubRepoId}`}
              >
                <span className="font-medium">{repository.fullName}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {repository.defaultBranch}
                </span>
              </Label>
              <div className="flex items-center gap-2">
                {/* Visibility and archive state are only known for repositories the installation
                    still reaches; a revoked entry must not be presented as public. */}
                {repository.accessible ? (
                  <>
                    {repository.private ? <StatusBadge status="disabled" label="Private" /> : null}
                    {repository.archived ? <StatusBadge status="skipped" label="Archived" /> : null}
                  </>
                ) : (
                  <StatusBadge status="blocked" label="Access revoked" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={
            fixtureMode || saving || (changes.select.length === 0 && changes.deselect.length === 0)
          }
          onClick={save}
          type="button"
        >
          Save selection
        </Button>
        {zeroAccess ? null : installationAction}
      </div>
    </section>
  );
}
