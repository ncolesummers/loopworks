import { Workflow } from "lucide-react";
import Link from "next/link";

import { resolvePortalEmptyState } from "@/components/portal/empty-states";
import { RegisteredLoopCard } from "@/components/portal/registered-loop-card";
import { EmptyState } from "@/components/portal/reusable-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type FirstRunState, isFirstRunUnavailable } from "@/lib/onboarding/first-run-state";
import type { RegisteredLoopItem } from "@/lib/types";

export function RegisteredLoopRegistry({
  firstRun,
  loops = [],
  sourceLabel = "Unavailable",
}: Readonly<{
  /** Composes the source state with the onboarding stage; a failed read suppresses the call to action. */
  firstRun?: FirstRunState;
  loops?: RegisteredLoopItem[];
  sourceLabel?: string;
}>) {
  const enabledCount = loops.filter((loop) => loop.enabled).length;
  const unavailable = firstRun !== undefined && isFirstRunUnavailable(firstRun);
  // Registration is the step this surface exists for, so it also names the earlier stages that
  // must happen before a loop can be scoped to a repository.
  const emptyState = resolvePortalEmptyState({
    fallback: "onboarding-no-loops",
    firstRun,
    stages: ["no-installation", "no-repositories", "no-loops"],
  });

  return (
    <Card aria-label="Registered loops" className="shadow-none" role="region">
      <CardHeader className="items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle>Registered loops</CardTitle>
          <CardDescription>
            Loop contracts registered against a tracked repository, with the triggers, gates, and
            approvals each one runs under.
          </CardDescription>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <span className="inline-flex min-h-6 max-w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
            <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{sourceLabel}</span>
            <span className="text-muted-foreground">{enabledCount} enabled</span>
          </span>
          {/*
            A failed read must not invite registration into a store it could not reach, and when
            the registry is empty the empty state already carries the operator's next step - which
            is not always registration, so duplicating it here would name the wrong one.
          */}
          {unavailable || loops.length === 0 ? null : (
            <Button asChild size="sm" variant="outline">
              <Link href="/loops/register">Register a loop</Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loops.length === 0 ? (
          <EmptyState spec={emptyState} />
        ) : (
          loops.map((loop) => (
            <RegisteredLoopCard key={`${loop.repositoryFullName}:${loop.key}`} loop={loop} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
