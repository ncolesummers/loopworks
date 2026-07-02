import { StatusBadge } from "@/components/ui/status-badge";
import { getRunStepStatus, getTimelineKindStatus } from "@/components/portal/status-mapping";
import type { TimelineEvent } from "@/lib/types";

export function RunTimelineItem({ event }: Readonly<{ event: TimelineEvent }>) {
  const status = event.status ? getRunStepStatus(event.status) : getTimelineKindStatus(event.kind);

  return (
    <div className="grid gap-2 rounded-md border p-4 md:grid-cols-[90px_minmax(0,1fr)]">
      <div className="text-sm font-medium text-muted-foreground">{event.at}</div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status.status} label={status.label} />
          <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium">
            {event.actor}
          </span>
          <div className="font-medium">{event.title}</div>
          {event.artifact ? (
            <StatusBadge status="ready" label={event.artifact} showIcon={false} />
          ) : null}
        </div>
        <div className="text-sm text-muted-foreground">{event.detail}</div>
        {event.validationCommand ? (
          <div className="font-mono text-xs text-muted-foreground">
            {event.validationCommand}
            {event.validationStatus ? ` -> ${event.validationStatus}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
