import { ExternalLink } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import { getValidationResultStatus } from "@/components/portal/status-mapping";
import type { ValidationResultRecord } from "@/lib/types";

export function ValidationResultSummary({
  results,
}: Readonly<{ results: ValidationResultRecord[] }>) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Validation results</CardTitle>
        <CardDescription>
          Deterministic evidence appears before review or approval decisions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {results.length === 0 ? (
          <div className="rounded-md border p-6">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">No validation results yet</p>
              <StatusBadge status="empty" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Deterministic checks will appear here after the first validation run.
            </p>
          </div>
        ) : (
          results.map((result) => {
            const status = getValidationResultStatus(result.status);
            const evidenceHref = getSafeExternalHref(result.artifactHref);

            return (
              <div
                key={result.name}
                className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{result.name}</div>
                    <StatusBadge status={status.status} label={status.label} />
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{result.command}</div>
                  <div className="text-sm text-muted-foreground">{result.detail}</div>
                </div>
                <div className="flex items-start justify-between gap-3 md:flex-col md:items-end">
                  <div className="text-xs text-muted-foreground">{result.duration}</div>
                  {evidenceHref ? (
                    <Button variant="ghost" size="sm" className="gap-2" asChild>
                      <a
                        href={evidenceHref}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${result.name} evidence`}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Evidence
                      </a>
                    </Button>
                  ) : result.artifactHref ? (
                    <StatusBadge status="failed" label="Invalid Evidence Link" />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
