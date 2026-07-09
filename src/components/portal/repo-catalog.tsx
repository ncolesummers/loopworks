"use client";

import { Settings2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";

import { getSafeExternalHref } from "@/components/portal/safe-url";
import { getRepoHealthStatus } from "@/components/portal/status-mapping";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RepoHealth, RepoRecord } from "@/lib/types";

type RepoHealthFilter = RepoHealth | "all";

const healthFilterOptions = [
  { value: "all", label: "All health" },
  { value: "healthy", label: "Healthy" },
  { value: "watch", label: "Watch" },
  { value: "blocked", label: "Blocked" },
  { value: "disconnected", label: "Disconnected" },
] satisfies { value: RepoHealthFilter; label: string }[];

function RepoLink({
  href,
  children,
  ariaLabel,
}: Readonly<{
  href: string | undefined;
  children: ReactNode;
  ariaLabel?: string;
}>) {
  const safeHref = getSafeExternalHref(href);

  if (!safeHref) {
    return null;
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel}
      className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </a>
  );
}

function RepoIdentity({ repo }: Readonly<{ repo: RepoRecord }>) {
  const label = `${repo.owner}/${repo.name}`;
  const safeHref = getSafeExternalHref(repo.githubHref);

  if (!safeHref) {
    return <div className="font-medium">{label}</div>;
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label}
    </a>
  );
}

function CatalogState({
  title,
  detail,
  status,
}: Readonly<{
  title: string;
  detail: string;
  status: "empty" | "loading";
}>) {
  return (
    <div className="rounded-md border p-6" aria-busy={status === "loading"}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      {status === "loading" ? (
        <div className="mt-4 grid gap-2" aria-hidden="true">
          <div className="h-3 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-4/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
      ) : null}
    </div>
  );
}

function repoMatchesSearch(repo: RepoRecord, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return true;
  }

  const searchableValues = [
    repo.owner,
    repo.name,
    repo.description,
    repo.health,
    repo.framework,
    repo.defaultBranch,
    repo.milestone,
    repo.area,
    repo.priority,
    ...repo.ciCommands,
    ...repo.enabledLoops,
    ...repo.validationGates,
  ];

  return searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function RepoCatalog({
  emptyDetail = "Connect a GitHub installation or adjust repo filters to populate the catalog.",
  repos,
  loading = false,
  sourceLabel,
}: Readonly<{
  emptyDetail?: string;
  repos: RepoRecord[];
  loading?: boolean;
  sourceLabel?: string;
}>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<RepoHealthFilter>("all");

  const filteredRepos = useMemo(
    () =>
      repos.filter(
        (repo) =>
          (healthFilter === "all" || repo.health === healthFilter) &&
          repoMatchesSearch(repo, searchQuery),
      ),
    [repos, healthFilter, searchQuery],
  );

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Repo catalog</CardTitle>
          <CardDescription>
            GitHub issues remain the canonical source. This view summarizes the repos that the
            portal is tracking.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sourceLabel ? (
            <span className="inline-flex h-6 items-center rounded-md border bg-background px-2 text-xs font-medium">
              {sourceLabel}
            </span>
          ) : null}
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <Link href="/github">
              <Settings2 className="h-4 w-4" />
              Repo filters
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent id="repos">
        {loading ? (
          <CatalogState
            title="Loading repositories"
            detail="Repository metadata, validation gates, and integration links are being refreshed."
            status="loading"
          />
        ) : repos.length === 0 ? (
          <CatalogState title="No repositories tracked" detail={emptyDetail} status="empty" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-2">
                <Label htmlFor="repo-catalog-search">Search repositories</Label>
                <Input
                  id="repo-catalog-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Owner, repo, framework, loop, or gate"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="repo-catalog-health">Filter by health</Label>
                <select
                  id="repo-catalog-health"
                  value={healthFilter}
                  onChange={(event) => setHealthFilter(event.target.value as RepoHealthFilter)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {healthFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredRepos.length === 0 ? (
              <CatalogState
                title="No repositories match the current filters"
                detail="Adjust search terms or health filters to broaden the catalog view."
                status="empty"
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Repository</th>
                      <th className="px-4 py-3 font-medium">Milestone</th>
                      <th className="px-4 py-3 font-medium">State</th>
                      <th className="px-4 py-3 font-medium">Open issues</th>
                      <th className="px-4 py-3 font-medium">Last sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRepos.map((repo) => {
                      const health = getRepoHealthStatus(repo.health);

                      return (
                        <tr key={`${repo.owner}/${repo.name}`} className="border-t">
                          <td className="px-4 py-4">
                            <RepoIdentity repo={repo} />
                            <div className="mt-1 max-w-xl text-xs text-muted-foreground">
                              {repo.description}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <StatusBadge status="ready" label={repo.framework} showIcon={false} />
                              <StatusBadge
                                status="queued"
                                label={repo.defaultBranch}
                                showIcon={false}
                              />
                              {repo.ciCommands.map((command) => (
                                <span
                                  key={command}
                                  className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs"
                                >
                                  {command}
                                </span>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <RepoLink href={repo.docsHref}>Docs</RepoLink>
                              <RepoLink href={repo.observabilityHref}>Observability</RepoLink>
                              <RepoLink href={repo.designSystemHref}>Design system</RepoLink>
                              <RepoLink
                                href={repo.vercelProjectHref}
                                ariaLabel={
                                  repo.vercelProjectId
                                    ? `Vercel project ${repo.vercelProjectId}`
                                    : undefined
                                }
                              >
                                {repo.vercelProjectId
                                  ? `Vercel project ${repo.vercelProjectId}`
                                  : "Vercel project"}
                              </RepoLink>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-1">
                              <span className="w-fit rounded-md border bg-background px-2 py-0.5 text-xs font-medium">
                                {repo.milestone}
                              </span>
                              <span className="text-xs text-muted-foreground">{repo.area}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <StatusBadge status={health.status} label={health.label} />
                            <div className="mt-2 text-xs text-muted-foreground">
                              Priority {repo.priority}
                            </div>
                            <div className="mt-3 space-y-2">
                              <div className="text-xs uppercase text-muted-foreground">
                                Enabled loops
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {repo.enabledLoops.length > 0 ? (
                                  repo.enabledLoops.map((loop) => (
                                    <StatusBadge
                                      key={loop}
                                      status="ready"
                                      label={loop}
                                      showIcon={false}
                                    />
                                  ))
                                ) : (
                                  <StatusBadge status="disabled" label="No loops enabled" />
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium">{repo.openIssues}</div>
                            <div className="text-xs text-muted-foreground">
                              Stale {repo.staleDays} days
                            </div>
                            <div className="mt-3 space-y-2">
                              <div className="text-xs uppercase text-muted-foreground">
                                Validation gates
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {repo.validationGates.length > 0 ? (
                                  repo.validationGates.map((gate) => (
                                    <StatusBadge
                                      key={gate}
                                      status="succeeded"
                                      label={gate}
                                      showIcon={false}
                                    />
                                  ))
                                ) : (
                                  <StatusBadge status="disabled" label="No gates configured" />
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-muted-foreground">{repo.lastSynced}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
