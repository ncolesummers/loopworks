import { getLoopEnabledStatus } from "@/components/portal/status-mapping";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RegisteredLoopItem } from "@/lib/types";

function FieldList({
  emptyLabel = "None",
  label,
  values,
}: Readonly<{ emptyLabel?: string; label: string; values: string[] }>) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {values.length === 0 ? (
        // An empty contract field is stated, never rendered as a missing row.
        <p className="mt-1 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul aria-label={label} className="mt-1 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-xs"
              key={value}
            >
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Renders a registered loop contract. Enabled state is shown, not toggled: changing it needs a
 * persisted mutation that #126 does not scope, and a toggle that silently forgets would be worse
 * than none.
 */
export function RegisteredLoopCard({ loop }: Readonly<{ loop: RegisteredLoopItem }>) {
  const enabled = getLoopEnabledStatus(loop.enabled);

  return (
    <article aria-label={loop.name} className="rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{loop.name}</div>
        <StatusBadge label={enabled.label} status={enabled.status} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{loop.repositoryFullName}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono text-xs">{loop.key}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FieldList label="Trigger labels" values={loop.triggerLabels} />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Validation gates
          </div>
          {loop.validationGates.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">None</p>
          ) : (
            <ul aria-label="Validation gates" className="mt-1 space-y-1">
              {loop.validationGates.map((gate) => (
                <li className="flex flex-wrap items-center gap-1.5 text-sm" key={gate.key}>
                  <span className="truncate">{gate.name}</span>
                  <span className="rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                    {gate.required ? "Required" : "Optional"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <FieldList label="Approval requirements" values={loop.approvalRequirements} />
      </div>
    </article>
  );
}
