import type { Meta, StoryObj } from "@storybook/nextjs";
import { AlertCircle, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <Card className="w-[480px]">
      <CardHeader>
        <CardTitle>
          <div className="h-5 w-36 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-4 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-4/6 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="mt-2 flex gap-3">
          <div className="h-9 w-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-9 w-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card className="w-[480px]">
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
        <Button variant="outline" size="sm">
          Connect repository
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ErrorState() {
  return (
    <Card className="w-[480px] border-danger-border bg-danger-muted">
      <CardContent className="flex flex-col gap-3 py-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-danger-foreground">GitHub sync failed</p>
            <p className="text-sm text-danger-foreground/80">
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

// ---------------------------------------------------------------------------
// Disabled control
// ---------------------------------------------------------------------------

function DisabledControl() {
  return (
    <Card className="w-[480px]">
      <CardHeader>
        <CardTitle className="text-sm">Approval gate</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Auto-merge is locked while a review is pending.
        </p>
        <div className="flex gap-2">
          <Button disabled>Approve &amp; merge</Button>
          <Button variant="outline" disabled>
            Request changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Showcase — all four states on one canvas
// ---------------------------------------------------------------------------

function StatesShowcase() {
  return (
    <div className="flex flex-col gap-8 p-2">
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Loading
        </h2>
        <LoadingSkeleton />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Empty
        </h2>
        <EmptyState />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Error
        </h2>
        <ErrorState />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Disabled
        </h2>
        <DisabledControl />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  title: "States/Showcase",
  component: StatesShowcase,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof StatesShowcase>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
