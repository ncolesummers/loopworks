import { ExternalLink, Monitor } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import {
  getDeploymentEnvironmentStatus,
  getDeploymentStatus,
} from "@/components/portal/status-mapping";
import type { DeploymentRecord } from "@/lib/types";
import type { Status } from "@/components/ui/status-badge";

function MetadataChip({
  children,
  mono = false,
}: Readonly<{
  children: string;
  mono?: boolean;
}>) {
  return (
    <span
      className={
        mono
          ? "rounded-md border bg-background px-2 py-0.5 font-mono text-xs"
          : "rounded-md border bg-background px-2 py-0.5 text-xs"
      }
    >
      {children}
    </span>
  );
}

function getCheckStatus(deployment: DeploymentRecord): Status {
  switch (deployment.state) {
    case "ready":
      return "succeeded";
    case "building":
      return "running";
    case "error":
      return "failed";
    case "queued":
      return "queued";
    case "canceled":
      return "canceled";
  }
}

export function DeploymentSummary({
  deployments,
  sourceLabel = "Fixture snapshot",
  emptyDetail = "Deployment and preview records will appear after the first Vercel webhook sync.",
}: Readonly<{
  deployments: DeploymentRecord[];
  sourceLabel?: string;
  emptyDetail?: string;
}>) {
  return (
    <Card className="shadow-none">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Vercel deployments and previews</CardTitle>
          <CardDescription>
            Preview URLs, build state, Vercel details, and event summaries are shown together so
            operators can decide whether a loop is ready to advance.
          </CardDescription>
        </div>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          {sourceLabel}
        </span>
      </CardHeader>
      <CardContent id="deployments" className="space-y-3">
        {deployments.length === 0 ? (
          <div className="rounded-md border p-6">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">No deployments available</p>
              <StatusBadge status="empty" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{emptyDetail}</p>
          </div>
        ) : (
          deployments.map((deployment) => {
            const href = getSafeExternalHref(deployment.url);
            const inspectorHref = getSafeExternalHref(deployment.inspectorUrl);
            const status = getDeploymentStatus(deployment.state);
            const environment = getDeploymentEnvironmentStatus(deployment.environment);
            const hasUrlValue = Boolean(deployment.url?.trim());
            const checkStatus = getCheckStatus(deployment);

            return (
              <div key={deployment.name} className="rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{deployment.name}</div>
                      <StatusBadge status={status.status} label={status.label} />
                      <StatusBadge status={environment.status} label={environment.label} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {deployment.branch ? <MetadataChip>{deployment.branch}</MetadataChip> : null}
                      {deployment.sha ? <MetadataChip mono>{deployment.sha}</MetadataChip> : null}
                      <MetadataChip>{deployment.age}</MetadataChip>
                    </div>
                    {!href ? (
                      <p className="text-xs text-muted-foreground">
                        {hasUrlValue ? "Invalid deployment URL" : "No preview URL yet"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        aria-label={`Open ${deployment.name}`}
                        disabled
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open
                      </Button>
                    )}
                    {inspectorHref ? (
                      <Button variant="outline" size="sm" className="gap-2" asChild>
                        <a
                          href={inspectorHref}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open Vercel details for ${deployment.name}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                          Details
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {deployment.checks.length > 0 ? (
                    deployment.checks.map((check) => (
                      <StatusBadge key={check} status={checkStatus} label={check} />
                    ))
                  ) : (
                    <StatusBadge status="queued" label="No event summary yet" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
