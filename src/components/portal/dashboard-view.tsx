"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock3,
  ExternalLink,
  FileJson2,
  GitBranch,
  GitPullRequestArrow,
  Monitor,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  Settings2,
  Sparkles,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { portalFixture } from "@/lib/fixtures";
import type { ApprovalState, DeploymentState, RepoHealth } from "@/lib/types";
import { cn } from "@/lib/utils";

const healthVariants: Record<RepoHealth, "success" | "warning" | "destructive"> = {
  healthy: "success",
  watch: "warning",
  blocked: "destructive",
};

const deploymentVariants: Record<
  DeploymentState,
  "success" | "warning" | "secondary" | "destructive"
> = {
  success: "success",
  preview: "warning",
  queued: "secondary",
  failed: "destructive",
};

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: Readonly<{
  label: string;
  value: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
}>) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{label}</CardDescription>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function RepoCatalog() {
  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Repo catalog</CardTitle>
          <CardDescription>
            GitHub issues remain the canonical source. This view summarizes the repos that the
            portal is tracking.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link href="/github">
            <Settings2 className="h-4 w-4" />
            Repo filters
          </Link>
        </Button>
      </CardHeader>
      <CardContent id="repos">
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Repository</th>
                <th className="px-4 py-3 font-medium">Milestone</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Open issues</th>
                <th className="px-4 py-3 font-medium">Last sync</th>
              </tr>
            </thead>
            <tbody>
              {portalFixture.repos.map((repo) => (
                <tr key={repo.name} className="border-t">
                  <td className="px-4 py-4">
                    <div className="font-medium">
                      {repo.owner}/{repo.name}
                    </div>
                    <div className="mt-1 max-w-xl text-xs text-muted-foreground">
                      {repo.description}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className="w-fit">
                        {repo.milestone}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{repo.area}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant={healthVariants[repo.health]}>{repo.health}</Badge>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Priority {repo.priority}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium">{repo.openIssues}</div>
                    <div className="text-xs text-muted-foreground">Stale {repo.staleDays} days</div>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">{repo.lastSynced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DeploymentPanel() {
  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Vercel deployments and previews</CardTitle>
          <CardDescription>
            Preview URLs, build state, and check summaries are shown together so operators can
            decide whether a loop is ready to advance.
          </CardDescription>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Monitor className="h-3.5 w-3.5" />
          Live snapshot
        </Badge>
      </CardHeader>
      <CardContent id="deployments" className="space-y-3">
        {portalFixture.deployments.map((deployment) => (
          <div key={deployment.name} className="rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{deployment.name}</div>
                  <Badge variant={deploymentVariants[deployment.state]}>{deployment.state}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {deployment.environment} / {deployment.branch} / {deployment.sha} /{" "}
                  {deployment.age}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Open
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {deployment.checks.map((check) => (
                <Badge key={check} variant="outline" className="gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  {check}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LoopRegistry() {
  const [loops, setLoops] = useState(portalFixture.loops);

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Loop registry</CardTitle>
          <CardDescription>
            Registry controls drive whether the intake, routing, and review loops are active.
          </CardDescription>
        </div>
        <Badge variant="secondary" className="gap-1.5">
          <Workflow className="h-3.5 w-3.5" />
          {loops.filter((loop) => loop.enabled).length} enabled
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {loops.map((loop, index) => (
          <div key={loop.name} className="flex items-center gap-4 rounded-md border p-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">{loop.name}</div>
                <Badge variant={loop.enabled ? "success" : "outline"}>
                  {loop.enabled ? "enabled" : "paused"}
                </Badge>
                <Badge
                  variant={
                    loop.risk === "high"
                      ? "destructive"
                      : loop.risk === "medium"
                        ? "warning"
                        : "secondary"
                  }
                >
                  {loop.risk} risk
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                State {loop.state} / owner {loop.owner} / queue depth {loop.queueDepth}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor={`loop-${index}`} className="text-xs text-muted-foreground">
                {loop.enabled ? "Active" : "Suspended"}
              </Label>
              <Switch
                id={`loop-${index}`}
                checked={loop.enabled}
                onCheckedChange={(checked) => {
                  setLoops((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, enabled: checked } : item,
                    ),
                  );
                }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TimelinePanel() {
  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Run timeline and artifacts</CardTitle>
          <CardDescription>
            Each event records why the loop moved, which actor changed it, and what artifact was
            produced.
          </CardDescription>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <FileJson2 className="h-3.5 w-3.5" />
          Append-only history
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {portalFixture.timeline.map((event) => (
          <div
            key={`${event.kind}-${event.at}`}
            className="grid gap-2 rounded-md border p-4 md:grid-cols-[90px_minmax(0,1fr)]"
          >
            <div className="text-sm font-medium text-muted-foreground">{event.at}</div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{event.actor}</Badge>
                <div className="font-medium">{event.title}</div>
                {event.artifact ? <Badge variant="success">{event.artifact}</Badge> : null}
              </div>
              <div className="text-sm text-muted-foreground">{event.detail}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ApprovalGate() {
  const [open, setOpen] = useState(false);
  const approvalState = portalFixture.approval.state as ApprovalState;

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Approval gate</CardTitle>
          <CardDescription>
            Security signoff is required before high-risk automation or write paths advance.
          </CardDescription>
        </div>
        <Badge
          variant={
            approvalState === "blocked"
              ? "destructive"
              : approvalState === "ready"
                ? "success"
                : "warning"
          }
        >
          {approvalState}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3 rounded-md border p-4">
            {portalFixture.approval.checklist.map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border",
                    item.done
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-amber-500 bg-amber-50 text-amber-700",
                  )}
                >
                  {item.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.done
                      ? "Verified against the fixture state."
                      : "Needs explicit maintainer review."}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="text-sm font-medium">Review details</div>
            <div className="text-sm text-muted-foreground">
              Owner {portalFixture.approval.owner}
            </div>
            <div className="text-sm text-muted-foreground">Due {portalFixture.approval.due}</div>
            <div className="text-sm text-muted-foreground">{portalFixture.approval.risk}</div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="w-full gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Request approval
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request security approval</DialogTitle>
                  <DialogDescription>
                    Confirm that the current portal snapshot is safe to advance. The request records
                    the same evidence that appears on the screen.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="requester">Requester</Label>
                    <Input id="requester" defaultValue="Colesummers" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Reviewer notes</Label>
                    <Textarea
                      id="notes"
                      defaultValue="Verified GitHub scoping, preview visibility, and redaction rules against the local fixture."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setOpen(false)} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Submit request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardView() {
  const metrics = useMemo(
    () => [
      {
        label: "Repos tracked",
        value: String(portalFixture.repos.length),
        detail: "Canonical GitHub repos currently linked to the portal.",
        icon: GitBranch,
      },
      {
        label: "Live previews",
        value: "2",
        detail: "Preview URLs that should be ready for operator review.",
        icon: GitPullRequestArrow,
      },
      {
        label: "Active loops",
        value: String(portalFixture.loops.filter((loop) => loop.enabled).length),
        detail: "Registry entries that are currently open for work intake and routing.",
        icon: PlayCircle,
      },
      {
        label: "Review gates",
        value: "1",
        detail: "Outstanding approval checkpoint before expansion of write access.",
        icon: PauseCircle,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Loopworks dashboard
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Agentic delivery loops, repo health, and deployment visibility
        </h1>
        <h2 className="sr-only">Dashboard overview</h2>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </section>

      <section id="repos" className="grid gap-4 xl:grid-cols-2">
        <RepoCatalog />
        <div id="deployments">
          <DeploymentPanel />
        </div>
      </section>

      <section id="loops" className="grid gap-4 xl:grid-cols-2">
        <LoopRegistry />
        <TimelinePanel />
      </section>

      <section id="approval">
        <ApprovalGate />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
        <Tabs defaultValue="overview" className="w-full">
          <Card className="shadow-none">
            <CardHeader className="flex-row items-end justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>Workflow lens</CardTitle>
                <CardDescription>
                  Switch between portal views without leaving the operator workspace.
                </CardDescription>
              </div>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="runs">Runs</TabsTrigger>
                <TabsTrigger value="governance">Governance</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="overview" className="mt-0">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Catalog
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      Issues mapped into loops and delivery tracks.
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Deployments
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      Preview and production state shown side by side.
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Approvals
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      High-risk transitions stop at the review gate.
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="runs" className="mt-0">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="h-4 w-4" />
                    Latest run window is 09:14 to 10:02.
                  </div>
                  <div className="rounded-md border p-4 text-sm">
                    Recent artifacts include preview URLs, validation output, and review notes.
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="governance" className="mt-0">
                <div className="flex items-start gap-3 rounded-md border p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">
                      Explicit approval before external writes
                    </div>
                    <div className="text-sm text-muted-foreground">
                      This portal only advances automation after the operator has reviewed the
                      checkpoint summary.
                    </div>
                  </div>
                </div>
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Operator notes</CardTitle>
            <CardDescription>
              Fixture-backed notes panel for day-two maintenance work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="search">Search repos</Label>
              <Input id="search" defaultValue="loopworks" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary">Snapshot summary</Label>
              <Textarea
                id="summary"
                defaultValue="Portal surfaces repo state, deploys, loop toggles, and security review checkpoints in one operator console."
              />
            </div>
            <Button className="w-full gap-2">
              <ArrowUpRight className="h-4 w-4" />
              Export snapshot
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
