"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock3, FileJson2, ShieldCheck } from "lucide-react";

import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { getApprovalStatus, getRunStatus } from "@/components/portal/status-mapping";
import { RunTimelineItem } from "@/components/portal/run-timeline-item";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RunRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function preferredInitialRun(runs: RunRecord[]): string | undefined {
  return runs.find((run) => run.status === "succeeded")?.id ?? runs[0]?.id;
}

export function RunRecordsView({
  runs,
  sourceLabel,
  emptyDetail = "Run state will appear after the control-plane store is available.",
}: Readonly<{
  emptyDetail?: string;
  runs: RunRecord[];
  sourceLabel: string;
}>) {
  const [selectedRunId, setSelectedRunId] = useState(() => preferredInitialRun(runs));
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const blockedCount = runs.filter((run) => run.status === "blocked").length;
  const waitingCount = runs.filter((run) => run.status === "waiting_for_approval").length;

  if (runs.length === 0) {
    return (
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Run timeline and artifacts</CardTitle>
          <CardDescription>{emptyDetail}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No runs available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Run timeline and artifacts</CardTitle>
          <CardDescription>
            Blocked and approval-waiting runs stay visible before lower-priority history.
          </CardDescription>
        </div>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
          <FileJson2 className="h-3.5 w-3.5 text-muted-foreground" />
          {sourceLabel}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-warning" />
              Waiting approval
            </div>
            <div className="mt-2 text-2xl font-semibold">{waitingCount}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Blocked
            </div>
            <div className="mt-2 text-2xl font-semibold">{blockedCount}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock3 className="h-4 w-4 text-muted-foreground" />
              Runs tracked
            </div>
            <div className="mt-2 text-2xl font-semibold">{runs.length}</div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]">
          <div className="space-y-2">
            {runs.map((run) => {
              const status = getRunStatus(run.status);
              const selected = run.id === selectedRun?.id;

              return (
                <Button
                  key={run.id}
                  type="button"
                  aria-pressed={selected}
                  variant="outline"
                  className={cn(
                    "h-auto w-full justify-start whitespace-normal p-3 text-left",
                    selected && "border-primary bg-accent",
                  )}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={status.status} label={run.priorityLabel} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {run.issue ?? "No issue"}
                      </span>
                    </span>
                    <span className="truncate text-sm font-medium">{run.repositoryFullName}</span>
                    <span className="text-xs text-muted-foreground">
                      {run.loopKey} / {run.currentStage} / {run.age}
                    </span>
                    {run.blockedReason ? (
                      <span className="text-xs text-muted-foreground">{run.blockedReason}</span>
                    ) : null}
                  </span>
                </Button>
              );
            })}
          </div>

          {selectedRun ? (
            <div className="space-y-4 rounded-md border p-4" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">Run detail</h3>
                  <div className="text-sm text-muted-foreground">
                    {selectedRun.repositoryFullName} / {selectedRun.loopKey}
                  </div>
                </div>
                <StatusBadge
                  status={getRunStatus(selectedRun.status).status}
                  label={selectedRun.priorityLabel}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border p-3 text-sm">
                  <div className="text-xs uppercase text-muted-foreground">Queued</div>
                  <div className="mt-1 font-medium">{selectedRun.queuedAt}</div>
                </div>
                <div className="rounded-md border p-3 text-sm">
                  <div className="text-xs uppercase text-muted-foreground">Stage</div>
                  <div className="mt-1 font-medium">{selectedRun.currentStage}</div>
                </div>
                <div className="rounded-md border p-3 text-sm">
                  <div className="text-xs uppercase text-muted-foreground">Issue</div>
                  <div className="mt-1 font-medium">{selectedRun.issue ?? "None"}</div>
                </div>
              </div>

              <div className="space-y-3">
                {selectedRun.steps.length > 0 ? (
                  selectedRun.steps.map((step) => <RunTimelineItem key={step.id} event={step} />)
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No run steps recorded
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-sm font-medium">Artifacts</div>
                  {selectedRun.artifacts.length > 0 ? (
                    selectedRun.artifacts.map((artifact) => (
                      <ArtifactListItem
                        key={`${selectedRun.id}-${artifact.label}`}
                        artifact={artifact}
                      />
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      No artifacts recorded
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium">Approvals</div>
                  {selectedRun.approvals.length > 0 ? (
                    selectedRun.approvals.map((approval) => {
                      const status = getApprovalStatus(approval.status);

                      return (
                        <div key={approval.id} className="space-y-2 rounded-md border p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium">{approval.scope}</div>
                            <StatusBadge status={status.status} label={status.label} />
                          </div>
                          <div className="grid gap-1 text-sm text-muted-foreground">
                            <span>Requested by {approval.requestedBy}</span>
                            <span>Requested at {approval.requestedAt}</span>
                            {approval.resolvedBy ? (
                              <span>Resolved by {approval.resolvedBy}</span>
                            ) : null}
                            {approval.resolvedAt ? (
                              <span>Resolved at {approval.resolvedAt}</span>
                            ) : null}
                            {approval.note ? <span>{approval.note}</span> : null}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      No approvals recorded
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
