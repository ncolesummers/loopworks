import { AlertCircle, Ban, FolderOpen, Loader2, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  type PortalEmptyStateAction,
  type PortalEmptyStateSpec,
  portalEmptyState,
} from "@/components/portal/empty-states";
import { getSafeExternalHref } from "@/components/portal/safe-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export function LoadingState() {
  return (
    <Card className="w-full max-w-[480px] shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-info motion-reduce:animate-none" />
          Loading snapshot
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-4 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-4/6 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </CardContent>
    </Card>
  );
}

/**
 * Whether an action will actually render an affordance. An action that cannot render one - a
 * reset with no handler, or an external href the allowlist rejects - must not be treated as an
 * action at all, or the empty state draws an action row around nothing and claims a next step
 * it does not offer.
 */
function actionRenders(
  action: PortalEmptyStateAction | undefined,
  input: Readonly<{ href?: string; onReset?: () => void }>,
): boolean {
  if (action === undefined) {
    return false;
  }

  if (action.kind === "reset") {
    return input.onReset !== undefined;
  }

  if (action.external === true) {
    return getSafeExternalHref(input.href ?? action.href) !== null;
  }

  return true;
}

function EmptyStateAction({
  action,
  href,
  onReset,
  variant = "default",
}: Readonly<{
  action: PortalEmptyStateAction | undefined;
  href?: string;
  onReset?: () => void;
  variant?: "default" | "outline";
}>) {
  if (!actionRenders(action, { href, onReset })) {
    return null;
  }

  // `actionRenders` already rejected `undefined`; this narrows for the compiler.
  if (action === undefined) {
    return null;
  }

  if (action.kind === "reset") {
    return (
      <Button onClick={onReset} size="sm" variant="outline">
        {action.label}
      </Button>
    );
  }

  const target = href ?? action.href;

  if (action.external === true) {
    return (
      <Button asChild size="sm" variant="outline">
        <a href={getSafeExternalHref(target) ?? undefined} rel="noreferrer" target="_blank">
          {action.label}
        </a>
      </Button>
    );
  }

  // Route handlers are not Next.js pages, so `next/link` prefetching does not apply to them.
  if (target.startsWith("/api/")) {
    return (
      <Button asChild size="sm" variant={variant}>
        <a href={target}>{action.label}</a>
      </Button>
    );
  }

  return (
    <Button asChild size="sm" variant={variant}>
      {/*
        Typed routes cannot narrow a value chosen from the registry at runtime. The inventory
        test proves every internal link href is a path the App Router actually serves, so the
        cast asserts something that is checked, not assumed.
      */}
      <Link href={target as Route}>{action.label}</Link>
    </Button>
  );
}

/**
 * The portal's one empty-state surface. Every zero-data state renders through this so the
 * inventory in `empty-states.ts` stays the single place that decides whether a state routes
 * somewhere or is terminal.
 *
 * `min-h-28` holds the shell's height across the loading, empty, and error states a surface
 * swaps between, so the page does not jump as data arrives.
 */
export function EmptyState({
  action,
  className,
  detail,
  href,
  onReset,
  spec,
}: Readonly<{
  /** Extra affordances beside the spec's action, for surfaces that offer a documented alternate route. */
  action?: ReactNode;
  className?: string;
  /** Overrides the spec's copy where the real reason is only known at runtime, such as a read error. */
  detail?: string;
  /** Overrides an external action's href where it is per-record, such as a GitHub installation URL. */
  href?: string;
  onReset?: () => void;
  spec: PortalEmptyStateSpec;
}>) {
  const Icon = spec.icon ?? FolderOpen;
  const titleId = `empty-state-${spec.id}`;
  const hasAction =
    actionRenders(spec.action, { href, onReset }) ||
    actionRenders(spec.secondaryAction, { onReset }) ||
    action !== undefined;

  return (
    // A named section, so the state's title is programmatically tied to the action beside it
    // rather than leaving the action an anonymous control in the accessibility tree.
    <section
      aria-labelledby={titleId}
      className={cn("min-h-28 rounded-md border border-dashed p-6", className)}
      data-empty-state={spec.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground" id={titleId}>
          {spec.title}
        </p>
        <StatusBadge status={spec.status} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{detail ?? spec.detail}</p>
      {hasAction ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* The primary action stays first in DOM and tab order (#151). */}
          <EmptyStateAction action={spec.action} href={href} onReset={onReset} />
          <EmptyStateAction action={spec.secondaryAction} onReset={onReset} variant="outline" />
          {action}
        </div>
      ) : null}
    </section>
  );
}

export function ErrorState() {
  return (
    <Card className="w-full max-w-[480px] border-danger-border bg-danger-muted shadow-none">
      <CardContent className="flex flex-col gap-3 py-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-danger-foreground">GitHub sync failed</p>
            <p className="text-sm text-danger-foreground">
              Could not reach the GitHub API. Check your network connection or token expiry.
            </p>
          </div>
        </div>
        <div className="flex gap-2 pl-8">
          <Button variant="outline" size="sm">
            Retry
          </Button>
          <Button variant="ghost" size="sm">
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DisabledState() {
  return (
    <Card className="w-full max-w-[480px] shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Ban className="h-4 w-4 text-muted-foreground" />
          Approval gate
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Auto-merge is locked while a review is pending.
        </p>
        <div className="flex gap-2">
          <Button disabled>Approve</Button>
          <Button variant="outline" disabled>
            Request changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function UnauthorizedState() {
  return (
    <Card className="w-full max-w-[480px] shadow-none">
      <CardContent className="flex flex-col gap-3 py-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium">Unauthorized workspace</p>
            <p className="text-sm text-muted-foreground">
              Sign in with an allowed GitHub account before viewing this portal.
            </p>
          </div>
        </div>
        <StatusBadge status="needsApproval" label="Access Required" />
      </CardContent>
    </Card>
  );
}

export function ReusableStates() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <LoadingState />
      <Card className="w-full max-w-[480px] shadow-none">
        <CardContent className="py-6">
          <EmptyState spec={portalEmptyState("onboarding-no-loops")} />
        </CardContent>
      </Card>
      <ErrorState />
      <DisabledState />
      <UnauthorizedState />
    </div>
  );
}
