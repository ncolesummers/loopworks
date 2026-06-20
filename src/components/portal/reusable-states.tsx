import { AlertCircle, Ban, FolderOpen, Loader2, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export function EmptyState() {
  return (
    <Card className="w-full max-w-[480px] shadow-none">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FolderOpen className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">No loops yet</p>
          <p className="text-sm text-muted-foreground">
            Connect a repo to register your first loop.
          </p>
        </div>
        <StatusBadge status="empty" />
      </CardContent>
    </Card>
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
      <EmptyState />
      <ErrorState />
      <DisabledState />
      <UnauthorizedState />
    </div>
  );
}
