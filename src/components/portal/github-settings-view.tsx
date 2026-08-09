"use client";

import { ExternalLink, KeyRound, Link2, Lock, RefreshCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { portalEmptyState } from "@/components/portal/empty-states";
import {
  type GithubInstallationOutcome,
  githubInstallationOutcomeCopy,
} from "@/components/portal/github-installation-outcome";
import { getEnabledStatus } from "@/components/portal/status-mapping";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GitHubInstallationRecord, GitHubSettingRecord } from "@/lib/types";

export function GitHubSettingsView({
  dataUnavailable = false,
  emptyDetail = "GitHub settings will be projected after repository and loop rows exist.",
  githubInstallations = [],
  installationOutcome,
  readOnly = false,
  settings: initialSettings = [],
  sourceLabel = "Unavailable",
}: Readonly<{
  dataUnavailable?: boolean;
  emptyDetail?: string;
  githubInstallations?: GitHubInstallationRecord[];
  installationOutcome?: GithubInstallationOutcome;
  readOnly?: boolean;
  settings?: GitHubSettingRecord[];
  sourceLabel?: string;
}>) {
  const [settings, setSettings] = useState(initialSettings);
  const hasInstallation = githubInstallations.length > 0;
  const noInstallationState = portalEmptyState("github-settings-no-installation");
  const noSettingsState = portalEmptyState("github-settings-none");
  // The result parameter is display-only (ADR 0021): it can never claim a
  // connection the rows do not show, and it must not claim the absence of one the
  // rows do show. Either direction would render a self-contradicting page.
  const displayedInstallationOutcome = hasInstallation
    ? installationOutcome === "no-installation-found"
      ? undefined
      : installationOutcome
    : installationOutcome === "connected" || installationOutcome === "already-connected"
      ? "error"
      : installationOutcome;
  const showFixtureControls = !readOnly && sourceLabel === "Fixture fallback";

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            GitHub settings
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Connection, label mapping, and dev fixtures
          </h1>
          <h2 className="sr-only">GitHub integration settings</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            This screen keeps the GitHub SSO and synchronization contract visible without forcing
            operators to leave the portal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={settings.length > 0 ? "ready" : "empty"} label={sourceLabel} />
          <StatusBadge
            status={hasInstallation ? "ready" : "empty"}
            // A failed read cannot render a connection call to action (ADR 0019),
            // so it must not claim "Not connected" either — that would be a
            // dead-end status with no affordance beside it (#151).
            label={
              dataUnavailable
                ? "Connection unknown"
                : hasInstallation
                  ? "GitHub app connected"
                  : "Not connected"
            }
          />
        </div>
      </section>

      {displayedInstallationOutcome ? (
        <div role="status" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
          {githubInstallationOutcomeCopy[displayedInstallationOutcome]}
        </div>
      ) : null}

      {settings.length === 0 ? (
        <Card className="shadow-none" data-empty-state={noSettingsState.id}>
          <CardHeader>
            <CardTitle>{noSettingsState.title}</CardTitle>
            <CardDescription>{emptyDetail}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Tabs defaultValue="connection" className="space-y-4">
          <TabsList>
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="scoping">Scoping</TabsTrigger>
            {showFixtureControls ? <TabsTrigger value="fixtures">Dev fixtures</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="connection" className="mt-0">
            <section className="grid gap-4 xl:grid-cols-2">
              <Card className="shadow-none">
                <CardHeader>
                  <CardTitle>Authentication and transport</CardTitle>
                  <CardDescription>
                    Operator access uses GitHub SSO. Repository and synchronization state are
                    projected from durable portal rows.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>GitHub App installation</Label>
                    {hasInstallation ? (
                      <div className="space-y-3 rounded-md border p-4">
                        {githubInstallations.map((installation) => (
                          <div
                            key={installation.installationId}
                            className="flex flex-wrap items-center justify-between gap-3"
                          >
                            <div>
                              <div className="text-sm font-medium">{installation.accountLogin}</div>
                              <div className="text-xs text-muted-foreground">
                                {installation.accountType} · {installation.repositorySelection}{" "}
                                repositories
                              </div>
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {installation.installationId}
                            </div>
                          </div>
                        ))}
                        <Button asChild variant="outline" size="sm">
                          <Link href="/settings/repositories">Select repositories</Link>
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"
                        data-empty-state={noInstallationState.id}
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{noInstallationState.title}</div>
                          <div className="text-sm text-muted-foreground">
                            {noInstallationState.detail}
                          </div>
                          {/*
                           * GitHub sends the operator to its configure page instead of
                           * the Setup URL when the account already has the App, so the
                           * install action alone can dead-end (#151).
                           */}
                          <div className="text-sm text-muted-foreground">
                            Already installed the Loopworks GitHub App on GitHub? Connect the
                            existing installation instead.
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button asChild>
                            <a href="/api/github/install">{noInstallationState.action?.label}</a>
                          </Button>
                          <Button asChild variant="outline">
                            <a href="/api/github/install/reconcile">
                              {noInstallationState.secondaryAction?.label}
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-4">
                    <div>
                      <div className="text-sm font-medium">Webhook ingest</div>
                      <div className="text-sm text-muted-foreground">
                        Issue, PR, and deployment signals hydrate the portal when durable rows are
                        present.
                      </div>
                    </div>
                    <StatusBadge
                      status={
                        settings.some((setting) => setting.key === "webhooks" && setting.enabled)
                          ? "ready"
                          : "empty"
                      }
                      label={
                        settings.some((setting) => setting.key === "webhooks" && setting.enabled)
                          ? "Projected"
                          : "No rows"
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardHeader>
                  <CardTitle>Security envelope</CardTitle>
                  <CardDescription>
                    Secrets stay out of UI output and write paths stay behind explicit review gates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3 rounded-md border p-4">
                    <Lock className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <div className="text-sm font-medium">Redaction rules</div>
                      <div className="text-sm text-muted-foreground">
                        Webhook payload fragments and token material are excluded from surfaced
                        summaries.
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border p-4">
                    <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <div className="text-sm font-medium">Least privilege</div>
                      <div className="text-sm text-muted-foreground">
                        Access is scoped to the repositories and actions needed for the portal
                        surface.
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Open security review
                  </Button>
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="scoping" className="mt-0">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>Repository and label scoping</CardTitle>
                <CardDescription>
                  Map issues, milestones, and labels into loop state without broadening access.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {settings.map((setting, index) => {
                  const settingStatus = getEnabledStatus(setting.enabled);

                  return (
                    <div key={setting.key}>
                      <div className="flex items-center gap-4 rounded-md border p-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{setting.title}</div>
                            <StatusBadge
                              status={settingStatus.status}
                              label={setting.enabled ? "On" : "Off"}
                            />
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">{setting.detail}</div>
                        </div>
                        <Switch
                          aria-label={setting.title}
                          checked={setting.enabled}
                          disabled={readOnly}
                          onCheckedChange={(checked) => {
                            setSettings((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, enabled: checked } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                      {index < settings.length - 1 ? <Separator className="my-3" /> : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {showFixtureControls ? (
            <TabsContent value="fixtures" className="mt-0">
              <section className="grid gap-4 xl:grid-cols-2">
                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle>Fixture control surface</CardTitle>
                    <CardDescription>
                      Development data is intentionally visible so the UI can be exercised without
                      live integrations.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3 rounded-md border p-4">
                      <KeyRound className="h-5 w-5 text-primary" />
                      <div>
                        <div className="text-sm font-medium">Auth bypass</div>
                        <div className="text-sm text-muted-foreground">
                          Local preview sessions use the shared fixture identity.
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-md border p-4">
                      <Link2 className="h-5 w-5 text-primary" />
                      <div>
                        <div className="text-sm font-medium">Source links</div>
                        <div className="text-sm text-muted-foreground">
                          Issue, PR, and deployment links appear as first-class metadata.
                        </div>
                      </div>
                    </div>
                    <Button className="gap-2">
                      <RefreshCcw className="h-4 w-4" />
                      Refresh fixture snapshot
                    </Button>
                  </CardContent>
                </Card>

                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle>Loaded settings</CardTitle>
                    <CardDescription>
                      The portal keeps the key development switches visible for Storybook and
                      Playwright coverage.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {settings.map((setting) => {
                      const settingStatus = getEnabledStatus(setting.enabled);

                      return (
                        <div
                          key={setting.key}
                          className="flex items-center justify-between rounded-md border px-4 py-3"
                        >
                          <div>
                            <div className="text-sm font-medium">{setting.title}</div>
                            <div className="text-xs text-muted-foreground">{setting.detail}</div>
                          </div>
                          <StatusBadge status={settingStatus.status} label={settingStatus.label} />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </div>
  );
}
