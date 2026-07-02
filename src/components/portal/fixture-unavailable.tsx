import { StatusBadge } from "@/components/ui/status-badge";

/**
 * `FixtureGatedPage` replaces an entire page's content with this notice in
 * production, so the headline doubles as that page's only heading - matching
 * the sr-only `h1` each wrapped page normally provides.
 */
export function FixtureUnavailableNotice({ area }: Readonly<{ area: string }>) {
  return (
    <div className="rounded-md border p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-medium">{area} is unavailable in production</h1>
        <StatusBadge status="empty" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        This surface is backed by local development fixtures only and fails closed in production
        until it is wired to a durable store.
      </p>
    </div>
  );
}
