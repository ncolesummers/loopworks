import Link from "next/link";
import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import { getRepoHealthStatus } from "@/components/portal/status-mapping";
import type { RepoRecord } from "@/lib/types";

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

export function RepoCatalog({ repos }: Readonly<{ repos: RepoRecord[] }>) {
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
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link href="/github">
            <Settings2 className="h-4 w-4" />
            Repo filters
          </Link>
        </Button>
      </CardHeader>
      <CardContent id="repos">
        {repos.length === 0 ? (
          <div className="rounded-md border p-6">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">No repositories tracked</p>
              <StatusBadge status="empty" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a GitHub installation or adjust repo filters to populate the catalog.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
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
                {repos.map((repo) => {
                  const health = getRepoHealthStatus(repo.health);

                  return (
                    <tr key={`${repo.owner}/${repo.name}`} className="border-t">
                      <td className="px-4 py-4">
                        <div className="font-medium">
                          {repo.owner}/{repo.name}
                        </div>
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
                            {repo.validationGates.map((gate) => (
                              <StatusBadge
                                key={gate}
                                status="succeeded"
                                label={gate}
                                showIcon={false}
                              />
                            ))}
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
      </CardContent>
    </Card>
  );
}
