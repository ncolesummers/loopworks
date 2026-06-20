"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, Link2, Lock, RefreshCcw, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getEnabledStatus } from "@/components/portal/status-mapping";
import { portalFixture } from "@/lib/fixtures";

export function GitHubSettingsView() {
  const [settings, setSettings] = useState(portalFixture.githubSettings);

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
        <StatusBadge status="ready" label="GitHub app connected" />
      </section>

      <Tabs defaultValue="connection" className="space-y-4">
        <TabsList>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="scoping">Scoping</TabsTrigger>
          <TabsTrigger value="fixtures">Dev fixtures</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="mt-0">
          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>Authentication and transport</CardTitle>
                <CardDescription>
                  Operator access uses GitHub SSO. Local development can bypass auth with fixture
                  mode enabled.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org">Organization</Label>
                  <Input id="org" defaultValue="ncolesummers" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="app-id">GitHub App installation</Label>
                  <Input
                    id="app-id"
                    defaultValue="installed on loopworks + integration-playground"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <div className="text-sm font-medium">Webhook ingest</div>
                    <div className="text-sm text-muted-foreground">
                      Issue, PR, and deployment signals hydrate the portal.
                    </div>
                  </div>
                  <StatusBadge status="ready" label="Enabled" />
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

        <TabsContent value="fixtures" className="mt-0">
          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>Fixture control surface</CardTitle>
                <CardDescription>
                  Development data is intentionally visible so the UI can be exercised without live
                  integrations.
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
                  The portal keeps the key development switches visible for Storybook and Playwright
                  coverage.
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
      </Tabs>
    </div>
  );
}
