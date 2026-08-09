import { Workflow } from "lucide-react";
import Link from "next/link";

import { RegisteredLoopCard } from "@/components/portal/registered-loop-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RegisteredLoopItem } from "@/lib/types";

export function RegisteredLoopRegistry({
  emptyDetail,
  loops = [],
  sourceLabel = "Unavailable",
}: Readonly<{
  /** Set only when the read failed; its presence is what suppresses the registration call to action. */
  emptyDetail?: string;
  loops?: RegisteredLoopItem[];
  sourceLabel?: string;
}>) {
  const enabledCount = loops.filter((loop) => loop.enabled).length;
  const unavailable = emptyDetail !== undefined;

  return (
    <Card aria-label="Registered loops" className="shadow-none" role="region">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Registered loops</CardTitle>
          <CardDescription>
            Loop contracts registered against a tracked repository, with the triggers, gates, and
            approvals each one runs under.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
            <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{sourceLabel}</span>
            <span className="text-muted-foreground">{enabledCount} enabled</span>
          </span>
          {unavailable ? null : (
            <Button asChild size="sm" variant="outline">
              <Link href="/loops/register">Register a loop</Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loops.length === 0 ? (
          <div className="rounded-md border border-dashed p-6">
            {unavailable ? (
              <>
                <div className="text-sm font-medium">Registered loops unavailable</div>
                <p className="mt-1 text-sm text-muted-foreground">{emptyDetail}</p>
              </>
            ) : (
              <>
                <div className="text-sm font-medium">No loops registered</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Register a loop against a tracked repository to give Loopworks something to run.
                </p>
              </>
            )}
          </div>
        ) : (
          loops.map((loop) => (
            <RegisteredLoopCard key={`${loop.repositoryFullName}:${loop.key}`} loop={loop} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
