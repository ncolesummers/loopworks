import { portalEmptyState } from "@/components/portal/empty-states";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * `FixtureGatedPage` replaces an entire page's content with this notice in
 * production, so the headline doubles as that page's only heading - matching
 * the sr-only `h1` each wrapped page normally provides. That heading requirement
 * is why this renders its own shell rather than the shared `EmptyState`, which
 * titles with a paragraph; the copy and terminal decision still come from the
 * registry.
 */
export function FixtureUnavailableNotice({ area }: Readonly<{ area: string }>) {
  const spec = portalEmptyState("fixture-only-surface");

  return (
    <div className="rounded-md border p-6" data-empty-state={spec.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-medium">{area} is unavailable in production</h1>
        <StatusBadge status={spec.status} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{spec.detail}</p>
    </div>
  );
}
