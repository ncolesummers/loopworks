import { ArrowUpRight, FileJson2 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import { getArtifactStatus } from "@/components/portal/status-mapping";
import type { ArtifactRecord } from "@/lib/types";

export function ArtifactListItem({ artifact }: Readonly<{ artifact: ArtifactRecord }>) {
  const href = getSafeExternalHref(artifact.href);
  const status =
    href || artifact.state === "pending"
      ? getArtifactStatus(artifact.state)
      : { status: "failed" as const, label: "Invalid Link" };

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-4">
      <div className="flex min-w-0 gap-3">
        <FileJson2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {artifact.label}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
              {artifact.label}
            </span>
          )}
          <div className="text-sm text-muted-foreground">{artifact.detail}</div>
        </div>
      </div>
      <StatusBadge status={status.status} label={status.label} />
    </div>
  );
}
