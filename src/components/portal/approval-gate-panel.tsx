"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { resolvePortalEmptyState } from "@/components/portal/empty-states";
import { EmptyState } from "@/components/portal/reusable-states";
import { getApprovalChecklistStatus, getApprovalStatus } from "@/components/portal/status-mapping";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { FirstRunState } from "@/lib/onboarding/first-run-state";
import type { ApprovalGateRecord } from "@/lib/types";

export function ApprovalGatePanel({
  approval,
  firstRun,
  sourceLabel = "Unavailable",
  enableActions = false,
  showEvidence = true,
}: Readonly<{
  approval: ApprovalGateRecord | null;
  /** A failed read must not be reported as a verified absence of approvals (ADR 0019). */
  firstRun?: FirstRunState;
  sourceLabel?: string;
  enableActions?: boolean;
  showEvidence?: boolean;
}>) {
  const [resolution, setResolution] = useState<{
    state: "approved" | "rejected";
    actor: string;
    occurredAt: string;
    note?: string;
  } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const awaitingRefresh = Boolean(resolution && approval?.state === "requested");
  useEffect(() => {
    if (!awaitingRefresh) return;
    const timeout = setTimeout(() => setRefreshFailed(true), 10_000);
    return () => clearTimeout(timeout);
  }, [awaitingRefresh]);
  const emptySpec = resolvePortalEmptyState({ fallback: "approval-none", firstRun });

  if (!approval) {
    return (
      <Card className="shadow-none">
        <CardHeader className="flex-row items-end justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Approval gate</CardTitle>
            <CardDescription>
              High-risk transitions stop here for an explicit operator decision.
            </CardDescription>
          </div>
          <StatusBadge status="empty" label={sourceLabel} />
        </CardHeader>
        <CardContent>
          <EmptyState spec={emptySpec} />
        </CardContent>
      </Card>
    );
  }

  const currentResolution = approval.state === "requested" ? resolution : null;
  const approvalStatus = getApprovalStatus(currentResolution?.state ?? approval.state);
  const gateName = approval.scope
    ? `${approval.scope} · run ${approval.runId?.slice(0, 8) ?? "not attached"} · gate ${approval.id?.slice(-8) ?? "fixture"}`
    : "Approval gate";
  const timestamp = currentResolution
    ? `Resolved ${new Date(currentResolution.occurredAt).toLocaleString()}`
    : /^(Requested|Resolved|Due|Expired)\b/.test(approval.due)
      ? approval.due
      : `Due ${approval.due}`;
  const decisionNote = currentResolution?.note ?? approval.decisionNote;

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>
            {showEvidence && approval.scope ? `Approval gate — ${gateName}` : "Approval gate"}
          </CardTitle>
          <CardDescription>
            Security signoff is required before high-risk automation or write paths advance.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="ready" label={sourceLabel} showIcon={false} />
          <StatusBadge status={approvalStatus.status} label={approvalStatus.label} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 break-words">
        {showEvidence && approval.runId && (
          <a
            aria-label={`View run — ${gateName}`}
            className="text-sm text-brand underline"
            href={`/runs?run=${encodeURIComponent(approval.runId)}`}
          >
            View run
          </a>
        )}
        {showEvidence && approval.plan && (
          <section aria-label="Plan under review" className="space-y-2 rounded-md border p-4">
            <p>Plan {approval.plan.id}</p>
            <p className="break-all font-mono text-xs">SHA256 {approval.plan.sha256}</p>
            {approval.plan.content ? (
              <pre className="whitespace-pre-wrap break-all text-sm">{approval.plan.content}</pre>
            ) : (
              <p>Plan content is unavailable. Review the linked plan evidence before deciding.</p>
            )}
          </section>
        )}
        <p
          ref={statusRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {resolution
            ? `${approvalStatus.label} — ${gateName}. Decision saved${awaitingRefresh && !refreshFailed ? " — refreshing…" : "."}`
            : ""}
        </p>
        {refreshFailed && awaitingRefresh && (
          <p role="alert">
            Decision saved. Reload to see the latest state; refresh could not be confirmed.{" "}
            <a href="/approvals" className="underline">
              Reload approvals
            </a>
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3 rounded-md border p-4">
            {approval.checklist
              .filter((item) => item.label !== `Requested by ${approval.owner}`)
              .map((item) =>
                currentResolution && item.label === "Awaiting resolution"
                  ? { ...item, label: "Resolution recorded", done: true }
                  : item,
              )
              .map((item) => {
                const itemStatus = getApprovalChecklistStatus(item.done);

                return (
                  <div key={item.label} className="flex items-start gap-3">
                    <StatusBadge status={itemStatus.status} label={itemStatus.label} dotOnly />
                    <div>
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.done
                          ? "Verified against the current portal state."
                          : "Needs explicit maintainer review."}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="text-sm font-medium">Review details</div>
            <div className="text-sm text-muted-foreground">Requested by {approval.owner}</div>
            <div className="text-sm text-muted-foreground">
              {currentResolution?.actor || approval.resolvedBy
                ? `Resolved by ${currentResolution?.actor ?? approval.resolvedBy}`
                : ["requested", "needs-review", "ready", "blocked"].includes(approval.state)
                  ? "Resolved by — awaiting decision"
                  : "Resolved by — not recorded"}
            </div>
            <div className="text-sm text-muted-foreground">{timestamp}</div>
            <div className="text-sm text-muted-foreground">{approval.risk}</div>

            {decisionNote && <div className="text-sm">Decision note: {decisionNote}</div>}
            {enableActions && approval.id && (approval.state === "requested" || resolution) && (
              <ApprovalDecision
                approvalId={approval.id}
                gateName={gateName}
                disabled={Boolean(resolution) || approval.state !== "requested"}
                onResolved={setResolution}
                onRefreshError={() => setRefreshFailed(true)}
                onCloseAfterSave={() => statusRef.current?.focus()}
              />
            )}
          </div>
        </div>
        {showEvidence && approval.artifacts?.length === 0 && (
          <p className="text-sm text-muted-foreground">No run evidence attached.</p>
        )}
        {(showEvidence ? (approval.artifacts ?? []) : []).map((artifact) => (
          <ArtifactListItem key={`${artifact.label}-${artifact.href}`} artifact={artifact} />
        ))}
      </CardContent>
    </Card>
  );
}

const decisionResponseSchema = z.object({
  approvalId: z.string(),
  transition: z.object({
    from: z.literal("requested"),
    to: z.enum(["approved", "rejected"]),
    actorId: z.string().min(1),
    occurredAt: z.iso.datetime(),
    note: z.string().optional(),
  }),
});

function ApprovalDecision({
  approvalId,
  onResolved,
  gateName,
  disabled,
  onRefreshError,
  onCloseAfterSave,
}: Readonly<{
  approvalId: string;
  onResolved: (resolution: {
    state: "approved" | "rejected";
    actor: string;
    occurredAt: string;
    note?: string;
  }) => void;
  gateName: string;
  disabled: boolean;
  onRefreshError: () => void;
  onCloseAfterSave: () => void;
}>) {
  const router = useRouter();
  const noteId = useId();
  const inFlight = useRef(false);
  const saved = useRef(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/approvals/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          expectedStatus: "requested",
          action,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!response.ok) {
        // Never render server error bodies: they may contain identifiers or internal detail.
        setError(
          response.status === 401 || response.status === 403
            ? "You are not authorized to make this decision. Sign in with an authorized account."
            : response.status === 404 || response.status === 409
              ? "This approval is no longer available for this decision. Refresh before trying again."
              : "The decision could not be saved. Refresh to check its status before trying again.",
        );
        return;
      }
      const result = decisionResponseSchema.parse(await response.json());
      if (
        result.approvalId !== approvalId ||
        result.transition.to !== (action === "approve" ? "approved" : "rejected")
      ) {
        throw new Error("Unexpected decision response");
      }
      saved.current = true;
      onResolved({
        state: result.transition.to,
        actor: result.transition.actorId,
        occurredAt: result.transition.occurredAt,
        note: result.transition.note,
      });
      setOpen(false);
      try {
        router.refresh();
      } catch {
        onRefreshError();
      }
    } catch {
      setError(
        "The decision could not be confirmed. Refresh to check its status before trying again.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          disabled={disabled}
          aria-label={`Review approval — ${gateName}`}
          className="w-full gap-2"
        >
          <ShieldCheck className="h-4 w-4" />
          Review approval
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (saved.current) {
            event.preventDefault();
            onCloseAfterSave();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Review {gateName}</DialogTitle>
          <DialogDescription>
            Confirm or reject {gateName}. Your signed-in operator identity is recorded with the
            decision.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={noteId}>Reviewer notes</Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={pending}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            aria-label={`Reject approval — ${gateName}`}
            variant="outline"
            disabled={pending}
            onClick={() => void decide("reject")}
          >
            Reject approval
          </Button>
          <Button
            aria-label={pending ? "Saving…" : `Confirm approval — ${gateName}`}
            disabled={pending}
            onClick={() => void decide("approve")}
          >
            {pending ? "Saving…" : "Confirm approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
