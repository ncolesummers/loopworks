"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  ArrowUpRight,
  Clock3,
  FileJson2,
  GitBranch,
  GitPullRequestArrow,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { LoopCard } from "@/components/portal/loop-card";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { RunTimelineItem } from "@/components/portal/run-timeline-item";
import { ValidationResultSummary } from "@/components/portal/validation-result-summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { portalFixture } from "@/lib/fixtures";
import { evaluateLoopTriggerDecision } from "@/lib/loops/trigger-decision";

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

export function LoopRegistry() {
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
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
          <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
          {loops.filter((loop) => loop.enabled).length} enabled
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {loops.map((loop, index) => (
          <LoopCard
            key={loop.name}
            loop={loop}
            onEnabledChange={(checked) => {
              setLoops((current) =>
                current.map((item, itemIndex) => {
                  if (itemIndex !== index) {
                    return item;
                  }

                  if (checked) {
                    return { ...item, enabled: true, skippedReason: undefined };
                  }

                  const decision = evaluateLoopTriggerDecision({
                    loop: { ...item, enabled: false },
                  });

                  return {
                    ...item,
                    enabled: false,
                    skippedReason: decision.skipped ? decision.reason : undefined,
                  };
                }),
              );
            }}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function TimelineAndArtifacts() {
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
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
          <FileJson2 className="h-3.5 w-3.5 text-muted-foreground" />
          Append-only history
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4">
          {portalFixture.timeline.map((event) => (
            <RunTimelineItem key={`${event.kind}-${event.at}`} event={event} />
          ))}
        </div>
        <div className="space-y-3">
          {portalFixture.artifacts.map((artifact) => (
            <ArtifactListItem key={`${artifact.label}-${artifact.href}`} artifact={artifact} />
          ))}
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
        <div className="text-xs uppercase text-muted-foreground">Loopworks dashboard</div>
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
        <RepoCatalog repos={portalFixture.repos} />
        <div id="deployments">
          <DeploymentSummary deployments={portalFixture.deployments} />
        </div>
      </section>

      <section id="loops" className="grid gap-4 xl:grid-cols-2">
        <LoopRegistry />
        <TimelineAndArtifacts />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ValidationResultSummary results={portalFixture.validationResults} />
        <div id="approval">
          <ApprovalGatePanel approval={portalFixture.approval} />
        </div>
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
                    <div className="text-xs uppercase text-muted-foreground">Catalog</div>
                    <div className="mt-2 text-sm font-medium">
                      Issues mapped into loops and delivery tracks.
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs uppercase text-muted-foreground">Deployments</div>
                    <div className="mt-2 text-sm font-medium">
                      Preview and production state shown side by side.
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs uppercase text-muted-foreground">Approvals</div>
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
