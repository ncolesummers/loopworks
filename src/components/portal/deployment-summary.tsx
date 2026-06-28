import { ExternalLink, Monitor } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import { getDeploymentStatus } from "@/components/portal/status-mapping";
import type { DeploymentRecord } from "@/lib/types";

export function DeploymentSummary({ deployments }: Readonly<{ deployments: DeploymentRecord[] }>) {
  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Vercel deployments and previews</CardTitle>
          <CardDescription>
            Preview URLs, build state, and check summaries are shown together so operators can
            decide whether a loop is ready to advance.
          </CardDescription>
        </div>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          Live snapshot
        </span>
      </CardHeader>
      <CardContent id="deployments" className="space-y-3">
        {deployments.length === 0 ? (
          <div className="rounded-md border p-6">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">No deployments available</p>
              <StatusBadge status="empty" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Deployment and preview records will appear after the first Vercel webhook sync.
            </p>
          </div>
        ) : (
          deployments.map((deployment) => {
            const href = getSafeExternalHref(deployment.url);
            const status =
              href || deployment.state === "queued"
                ? getDeploymentStatus(deployment.state)
                : { status: "failed" as const, label: "Invalid Link" };

            return (
              <div key={deployment.name} className="rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{deployment.name}</div>
                      <StatusBadge status={status.status} label={status.label} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {deployment.environment} / {deployment.branch} / {deployment.sha} /{" "}
                      {deployment.age}
                    </div>
                  </div>
                  {href ? (
                    <Button variant="ghost" size="sm" className="gap-2" asChild>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${deployment.name}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open
                      </a>
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="gap-2" disabled>
                      <ExternalLink className="h-4 w-4" />
                      Open
                    </Button>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {deployment.checks.map((check) => (
                    <StatusBadge key={check} status="succeeded" label={check} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
