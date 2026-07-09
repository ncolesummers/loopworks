import { ExternalLink, FileJson2 } from "lucide-react";

import { getSafeExternalHref } from "@/components/portal/safe-url";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Status } from "@/components/ui/status-badge";
import type { ValidationGateOutcome, ValidationGateSummaryRecord } from "@/lib/types";

function getValidationGateStatus(outcome: ValidationGateOutcome): {
  label: string;
  status: Status;
} {
  const statuses = {
    pass: { label: "Passed", status: "succeeded" },
    fail: { label: "Failed", status: "failed" },
    skipped: { label: "Skipped", status: "skipped" },
  } satisfies Record<ValidationGateOutcome, { label: string; status: Status }>;

  return statuses[outcome];
}

function ValidationGateStateShell({
  detail,
  state,
}: Readonly<{
  detail: string;
  state: "empty" | "error" | "loading";
}>) {
  const status =
    state === "loading"
      ? { label: "Loading", status: "loading" as const }
      : state === "error"
        ? { label: "Failed", status: "failed" as const }
        : { label: "Empty", status: "empty" as const };
  const title =
    state === "loading"
      ? "Loading validation gates"
      : state === "error"
        ? "Validation summary unavailable"
        : "No validation gates yet";

  return (
    <div className="min-h-28 rounded-md border border-dashed p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        <StatusBadge status={status.status} label={status.label} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ValidationGateSummary({
  loading = false,
  summary,
}: Readonly<{
  loading?: boolean;
  summary: ValidationGateSummaryRecord;
}>) {
  return (
    <section aria-label="Validation gates" className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-sm font-medium">Validation gates</h4>
          {summary.state === "ready" ? (
            <p className="text-sm text-muted-foreground">{summary.detail}</p>
          ) : null}
        </div>
        {summary.generatedAt ? (
          <span className="font-mono text-xs text-muted-foreground">
            {summary.generatedAt.slice(11, 16)}
          </span>
        ) : null}
      </div>

      {loading ? (
        <ValidationGateStateShell detail="Validation gates are loading." state="loading" />
      ) : summary.state === "error" ? (
        <ValidationGateStateShell detail={summary.detail} state="error" />
      ) : summary.state === "empty" || summary.gates.length === 0 ? (
        <ValidationGateStateShell detail={summary.detail} state="empty" />
      ) : (
        <ul className="space-y-3">
          {summary.gates.map((gate) => {
            const status = getValidationGateStatus(gate.outcome);
            const rawArtifactHref = getSafeExternalHref(gate.rawArtifactHref);

            return (
              <li
                key={gate.key}
                className="grid min-h-28 gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                data-validation-gate-row={gate.key}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium">{gate.name}</div>
                    <StatusBadge status={status.status} label={status.label} />
                    <StatusBadge
                      status={gate.required ? "needsApproval" : "skipped"}
                      label={gate.required ? "Required" : "Optional"}
                    />
                  </div>
                  <div className="break-all font-mono text-xs text-muted-foreground">
                    {gate.command}
                  </div>
                  <div className="break-words text-sm text-muted-foreground">{gate.detail}</div>
                </div>

                <div className="flex min-w-0 items-start justify-between gap-3 md:flex-col md:items-end">
                  <span className="font-mono text-xs text-muted-foreground">{gate.duration}</span>
                  {rawArtifactHref ? (
                    <Button variant="ghost" size="sm" className="gap-2" asChild>
                      <a
                        href={rawArtifactHref}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open raw artifact for ${gate.name}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Raw artifact
                      </a>
                    </Button>
                  ) : gate.rawArtifactHref ? (
                    <StatusBadge status="failed" label="Invalid raw artifact link" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileJson2 className="h-3.5 w-3.5" aria-hidden="true" />
                      No raw artifact
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
