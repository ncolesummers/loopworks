"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { type PortalEmptyStateId, portalEmptyState } from "@/components/portal/empty-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Status } from "@/components/ui/status-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { firstLoopRegistrationDefaults } from "@/lib/loops/loop-registration";
import type {
  LoopRegistrationFormInput,
  LoopRegistrationResult,
  LoopRegistrationSnapshot,
} from "@/lib/loops/loop-registration-flow";

/** Keeps the surface the same height across loading, empty, error, and populated states. */
const surfaceClassName = "min-h-[24rem] rounded-md border p-6";

async function postLoopRegistration(
  input: LoopRegistrationFormInput,
): Promise<LoopRegistrationResult> {
  const response = await fetch("/api/loops", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  // 400 (invalid), 409 (duplicate), and 422 (missing repository) all carry a body the operator
  // needs; keying only on `response.ok` would collapse them into a generic failure.
  let payload: Partial<LoopRegistrationResult> | null = null;
  try {
    payload = (await response.json()) as Partial<LoopRegistrationResult>;
  } catch {
    payload = null;
  }
  if (payload?.status === "registered" && payload.loopKey) {
    return { loopKey: payload.loopKey, status: "registered" };
  }
  if (payload?.status === "invalid") return { errors: payload.errors ?? [], status: "invalid" };
  if (payload?.status === "duplicate-key") return { status: "duplicate-key" };
  if (payload?.status === "repository-missing") return { status: "repository-missing" };
  return { reason: `http_${response.status}`, status: "error" };
}

function SurfaceState({
  action,
  busy = false,
  detail,
  emptyStateId,
  status,
  title,
}: Readonly<{
  action?: React.ReactNode;
  busy?: boolean;
  detail: string;
  /** Set for zero-data states so the empty-state inventory can find them. */
  emptyStateId?: PortalEmptyStateId;
  status: Status;
  title: string;
}>) {
  return (
    <section
      aria-busy={busy}
      aria-label="Loop registration"
      className={surfaceClassName}
      data-empty-state={emptyStateId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{detail}</p>
      {busy ? (
        <div aria-hidden="true" className="mt-4 grid gap-2">
          <div className="h-3 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-4/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

/** A blank entry between commas is a typing artifact, not a label the operator meant to add. */
function parseTriggerLabels(value: string): string[] {
  return value
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

export function LoopRegistrationView({
  fixtureMode = false,
  loading = false,
  onRegistered,
  register = postLoopRegistration,
  snapshot,
}: Readonly<{
  /** Fixture repositories carry ids the database does not know, so registering is disabled. */
  fixtureMode?: boolean;
  loading?: boolean;
  onRegistered?: () => void;
  register?: (input: LoopRegistrationFormInput) => Promise<LoopRegistrationResult>;
  snapshot: LoopRegistrationSnapshot;
}>) {
  const fieldId = useId();
  const repositories = snapshot.repositories ?? [];
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? "");
  const [name, setName] = useState(firstLoopRegistrationDefaults.name);
  const [key, setKey] = useState(firstLoopRegistrationDefaults.key);
  const [triggerLabels, setTriggerLabels] = useState(
    firstLoopRegistrationDefaults.issueLabels.join(", "),
  );
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <SurfaceState
        busy
        detail="Reading the repositories this loop can be scoped to."
        status="loading"
        title="Loading tracked repositories"
      />
    );
  }

  if (snapshot.status === "error") {
    return (
      <SurfaceState
        detail="The tracked repository list could not be read, so a loop cannot be scoped right now. Retry once the store is reachable."
        status="failed"
        title="Loop registration unavailable"
      />
    );
  }

  if (snapshot.status === "no-tracked-repositories") {
    const spec = portalEmptyState("loop-registration-no-repositories");

    return (
      <SurfaceState
        action={
          <Button asChild variant="outline">
            <Link href="/settings/repositories">Select repositories</Link>
          </Button>
        }
        detail={spec.detail}
        emptyStateId="loop-registration-no-repositories"
        status={spec.status}
        title={spec.title}
      />
    );
  }

  async function submit() {
    if (fixtureMode || saving) return;
    setSaving(true);
    setMessage(null);

    try {
      const result = await register({
        enabled,
        issueLabels: parseTriggerLabels(triggerLabels),
        key: key.trim(),
        name: name.trim(),
        repositoryId,
      });

      if (result.status === "registered") {
        setMessage(`Registered ${result.loopKey}. It now appears in the loop registry.`);
        onRegistered?.();
        return;
      }
      if (result.status === "invalid") {
        setMessage(
          `The loop contract is not valid yet. ${result.errors
            .map((error) => `${error.path}: ${error.message} ${error.hint}`)
            .join(" ")}`,
        );
        return;
      }
      if (result.status === "duplicate-key") {
        setMessage("That loop key is already in use on this repository. Choose another key.");
        return;
      }
      if (result.status === "repository-missing") {
        setMessage("That repository is no longer tracked. Reload and choose another repository.");
        return;
      }
      setMessage("The loop could not be registered. Try again.");
    } catch {
      // A rejected fetch must not leave the operator with a silently re-enabled button and no reason.
      setMessage("The loop could not be registered. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Loop registration" className={surfaceClassName}>
      <form
        aria-label="Register a loop"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1">
          <p className="text-sm font-medium">Register a development loop</p>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Budgets, artifact contracts, approval gates, and the retry policy come from the shipped
            development loop. Choose the repository and the labels that should trigger it.
          </p>
        </div>

        {fixtureMode ? (
          <p className="mt-4 text-sm text-muted-foreground">
            This surface is showing fixture data, so registration is disabled.
          </p>
        ) : null}

        {message ? (
          <div className="mt-4 rounded-md border bg-muted/40 px-4 py-3 text-sm" role="status">
            {message}
          </div>
        ) : null}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Repository</legend>
          <ul className="mt-2 divide-y rounded-md border">
            {repositories.map((repository) => (
              <li className="flex items-center gap-3 px-4 py-3" key={repository.id}>
                <input
                  checked={repositoryId === repository.id}
                  className="h-4 w-4 border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  id={`${fieldId}-repository-${repository.id}`}
                  name={`${fieldId}-repository`}
                  onChange={() => setRepositoryId(repository.id)}
                  type="radio"
                  value={repository.id}
                />
                <Label
                  className="flex-1 cursor-pointer font-normal"
                  htmlFor={`${fieldId}-repository-${repository.id}`}
                >
                  <span className="font-medium">{repository.fullName}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {repository.defaultBranch}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-name`}>Loop name</Label>
            <Input
              id={`${fieldId}-name`}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-key`}>Loop key</Label>
            <Input
              id={`${fieldId}-key`}
              onChange={(event) => setKey(event.target.value)}
              value={key}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor={`${fieldId}-triggers`}>Trigger labels</Label>
          <Input
            id={`${fieldId}-triggers`}
            onChange={(event) => setTriggerLabels(event.target.value)}
            placeholder="agent-ready, status:ready"
            value={triggerLabels}
          />
          <p className="text-sm text-muted-foreground">
            Comma-separated GitHub labels that identify issues eligible for this registered loop.
          </p>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <input
            checked={enabled}
            className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            id={`${fieldId}-enabled`}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <Label className="font-normal" htmlFor={`${fieldId}-enabled`}>
            Enabled
          </Label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={fixtureMode || saving} type="submit">
            Register loop
          </Button>
          <Button asChild variant="outline">
            <Link href="/loops">Back to loops</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}
