import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { Client, type ClientSession, type MessageStreamEvent } from "eve/client";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("probe_invalid_record");
  return value as Record<string, unknown>;
}
function requireEvidence(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`probe_${code}`);
}
function actions(events: readonly MessageStreamEvent[], name: string) {
  return events.flatMap((event, index) => {
    if (
      event.type !== "action.result" ||
      event.data.result.kind !== "tool-result" ||
      event.data.result.toolName !== name
    )
      return [];
    return [{ index, status: event.data.status, result: event.data.result }];
  });
}
export function childTurnSettled(events: readonly MessageStreamEvent[]) {
  const outcomes = actions(events, "approved_marker");
  const outcome = outcomes.at(-1);
  return (
    outcome !== undefined &&
    events
      .slice(outcome.index + 1)
      .some((event) => event.type === "turn.completed" || event.type === "session.completed")
  );
}
function approval(events: readonly MessageStreamEvent[], marker: string) {
  return events
    .flatMap((event) => (event.type === "input.requested" ? event.data.requests : []))
    .find(
      (request) =>
        request.kind === "tool-approval" &&
        request.action.toolName === "approved_marker" &&
        request.action.input.marker === marker,
    );
}
function admission(events: readonly MessageStreamEvent[], parentId: string) {
  const calls = events.filter((event) => event.type === "subagent.called");
  requireEvidence(calls.length === 1, "expected_one_child");
  const call = calls[0];
  requireEvidence(call, "missing_child");
  requireEvidence(
    call.data.name === "worker" && call.data.sessionId === parentId,
    "wrong_parent_or_worker",
  );
  const receipt = events.find(
    (event) =>
      event.type === "subagent.completed" &&
      event.data.callId === call.data.callId &&
      event.data.subagentName === "worker",
  );
  requireEvidence(
    receipt?.type === "subagent.completed" && receipt.data.backgroundTask?.status === "working",
    "missing_background_receipt",
  );
  // Child identity is emitted asynchronously and can follow the working receipt.
  // The originating model action must still precede that receipt.
  const requestIndex = events.findIndex(
    (event) =>
      event.type === "actions.requested" &&
      event.data.actions.some(
        (action) =>
          action.kind === "tool-call" &&
          action.toolName === "worker" &&
          action.callId === call.data.callId,
      ),
  );
  requireEvidence(
    requestIndex >= 0 && requestIndex < events.indexOf(receipt),
    "receipt_before_admission",
  );
  return {
    childId: call.data.childSessionId,
    taskId: receipt.data.backgroundTask.taskId,
    receiptIndex: events.indexOf(receipt),
  };
}

export type ProbeEvidence = {
  mode: "approve" | "deny" | "cancel";
  marker: string;
  parentId: string;
  childId: string;
  parent: readonly MessageStreamEvent[];
  before: readonly MessageStreamEvent[];
  after: readonly MessageStreamEvent[];
};

export function assertProbeOutcome(input: ProbeEvidence) {
  const { mode, parentId, childId, marker, parent, before, after } = input;
  const admitted = admission(parent, parentId);
  requireEvidence(admitted.childId === childId, "wrong_child");
  for (const event of [...parent, ...after]) {
    requireEvidence(!["turn.failed", "session.failed"].includes(event.type), "runtime_failed");
  }
  const pending = approval(before, marker);
  const forwarded = approval(parent, marker);
  requireEvidence(
    pending &&
      forwarded &&
      forwarded.requestId === `${admitted.taskId}:${pending.requestId}` &&
      forwarded.action.callId === pending.action.callId,
    "missing_forwarded_approval",
  );
  const requestIndex = before.findIndex(
    (event) =>
      event.type === "input.requested" &&
      event.data.requests.some((request) => request.requestId === pending.requestId),
  );
  requireEvidence(
    before.slice(requestIndex + 1).some((event) => event.type === "session.waiting"),
    "child_not_parked",
  );
  requireEvidence(
    before.every((event, index) => JSON.stringify(event) === JSON.stringify(after[index])),
    "child_history_reordered",
  );
  const forwardedIndex = parent.findIndex(
    (event) =>
      event.type === "input.requested" &&
      event.data.requests.some((request) => request.requestId === forwarded.requestId),
  );
  requireEvidence(forwardedIndex > admitted.receiptIndex, "approval_before_admission");
  requireEvidence(actions(before, "approved_marker").length === 0, "executed_before_response");
  const outcomes = actions(after, "approved_marker");
  const taskResults = actions(parent, "task_cancel");
  requireEvidence(
    taskResults.length === 1 && taskResults[0] && taskResults[0].index > forwardedIndex,
    "task_terminal_before_approval",
  );
  const terminal = taskResults
    .flatMap(({ result, status }) => {
      if (status !== "completed") return [];
      const output = record(result.output);
      return Array.isArray(output.tasks) ? output.tasks.map(record) : [];
    })
    .find((task) => task.taskId === admitted.taskId);
  requireEvidence(
    terminal?.status === (mode === "cancel" ? "cancelled" : "completed"),
    "missing_terminal_task",
  );
  if (mode === "cancel") {
    requireEvidence(
      outcomes.every((outcome) => outcome.status !== "completed"),
      "executed_after_cancellation",
    );
    // Cancelling an already parked child does not create another turn event.
    // The correlated task_cancel terminal receipt above is authoritative.
  } else {
    const resolutionIndex = after.findIndex(
      (event) =>
        event.type === "input.resolved" &&
        event.data.resolutions.some(
          (resolution) =>
            resolution.requestId === pending.requestId &&
            resolution.kind === "tool-approval" &&
            resolution.outcome === (mode === "approve" ? "approved" : "denied"),
        ),
    );
    requireEvidence(resolutionIndex >= 0, "missing_accepted_response");
    requireEvidence(
      outcomes.length === 1 && outcomes[0] && outcomes[0].index > resolutionIndex,
      "incorrect_execution_order_or_count",
    );
    const outcome = outcomes[0];
    requireEvidence(outcome, "missing_action");
    requireEvidence(outcome.result.callId === pending.action.callId, "wrong_action_call");
    requireEvidence(
      outcome.status === (mode === "approve" ? "completed" : "rejected"),
      "incorrect_action_outcome",
    );
    if (mode === "approve")
      requireEvidence(record(outcome.result.output).approvedMarker === marker, "wrong_marker");
    requireEvidence(
      after
        .slice(outcome.index + 1)
        .some((event) => event.type === "turn.completed" || event.type === "session.completed"),
      "missing_child_completion",
    );
  }
  return {
    mode,
    parentId,
    childId,
    taskId: admitted.taskId,
    requestId: pending.requestId,
    status: "passed",
  };
}

export function stageRuntimeProbe(repositoryRoot: string, destination: string) {
  const source = path.resolve(repositoryRoot);
  const target = path.resolve(destination);
  const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
  const lock = readFileSync(path.join(source, "bun.lock"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  const identity = {
    commit,
    eve: manifest.dependencies.eve,
    ai: manifest.dependencies.ai,
    lockSha256: createHash("sha256").update(lock).digest("hex"),
  };
  // Exclusive creation: never overwrite a checkout or an existing linked project.
  mkdirSync(target);
  writeFileSync(
    path.join(target, "package.json"),
    `${JSON.stringify({ ...manifest, scripts: { build: "eve build" } }, null, 2)}\n`,
  );
  writeFileSync(path.join(target, "bun.lock"), lock);
  cpSync(path.join(source, "patches"), path.join(target, "patches"), { recursive: true });
  cpSync(path.join(source, "scripts/eve-runtime-probe/agent"), path.join(target, "agent"), {
    recursive: true,
  });
  writeFileSync(path.join(target, "probe-identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
  writeFileSync(
    path.join(target, "vercel.json"),
    `${JSON.stringify({ framework: "eve", buildCommand: "bun run build", installCommand: "bun install --frozen-lockfile" }, null, 2)}\n`,
  );
  writeFileSync(path.join(target, ".gitignore"), "node_modules\n.eve\n.output\n.vercel\n.env*\n");
  return identity;
}

// Do not race this promise against a shorter timeout: a late successful response
// must register its handle before cleanup runs. The SDK receives the abort signal.
export async function acceptOwnedSession<S, T extends { session: S }>(
  create: (signal: AbortSignal) => Promise<T>,
  owned: S[],
  signal: AbortSignal,
): Promise<T> {
  const created = await create(signal);
  owned.push(created.session);
  return created;
}

async function bounded<T>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe_request_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runRuntimeProbe(host: string, token: string) {
  const url = new URL(host);
  requireEvidence(
    url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.app") &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "invalid_host",
  );
  requireEvidence(url.hostname.startsWith("loopworks-runtime-probe-"), "not_isolated_probe_host");
  const client = new Client({
    host: url.origin,
    auth: { vercelOidc: { token } },
    redirect: "error",
  });
  const owned: ClientSession[] = [];
  const results = [];
  try {
    const health = await bounded(client.health());
    requireEvidence(health.status === "ready", "not_ready");
    for (const mode of ["approve", "deny", "cancel"] as const) {
      const signal = AbortSignal.timeout(180_000);
      const marker = randomUUID();
      const created = await acceptOwnedSession(
        (requestSignal) =>
          client.sessions.create({
            message: `START ${marker}`,
            signal: requestSignal,
            turnPolicy: "queue",
          }),
        owned,
        signal,
      ).catch((error: unknown) => {
        console.log(JSON.stringify({ mode, status: "creation_cleanup_unconfirmed" }));
        throw error;
      });
      console.log(
        JSON.stringify({ mode, parentId: created.session.state.sessionId, status: "started" }),
      );
      // Consume only the initiating turn; later snapshots observe background state.
      await bounded(created.response.result(), 60_000);
      const parentId = created.session.state.sessionId;
      let child: ClientSession | undefined;
      let taskId = "";
      let before: readonly MessageStreamEvent[] = [];
      let parent: readonly MessageStreamEvent[] = [];
      while (!signal.aborted) {
        parent = (await created.session.snapshot({ signal })).events;
        try {
          const admitted = admission(parent, parentId);
          taskId = admitted.taskId;
          child = client.sessions.attach(admitted.childId);
          before = (await child.snapshot({ signal })).events;
          if (
            approval(parent, marker) &&
            approval(before, marker) &&
            before.some((event) => event.type === "session.waiting")
          )
            break;
        } catch (error) {
          if (
            error instanceof Error &&
            !error.message.startsWith("probe_expected_one_child") &&
            !error.message.startsWith("probe_missing_background_receipt")
          )
            throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      requireEvidence(child && approval(before, marker) && !signal.aborted, "approval_timeout");
      requireEvidence(actions(before, "approved_marker").length === 0, "executed_before_approval");
      const request = approval(parent, marker);
      requireEvidence(request, "missing_parent_approval");
      console.log(
        JSON.stringify({
          mode,
          taskId,
          childId: child.state.sessionId,
          requestId: request.requestId,
          status: "parked_before_execution",
        }),
      );
      if (mode !== "cancel") {
        const response = await created.session.respond(
          [{ requestId: request.requestId, optionId: mode === "approve" ? "approve" : "cancel" }],
          { signal },
        );
        await bounded(response.result(), 60_000);
        // Wait for the owned child to settle before the harmless terminal-status query.
        while (!signal.aborted) {
          const events = (await child.snapshot({ signal })).events;
          if (childTurnSettled(events)) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        requireEvidence(!signal.aborted, "child_completion_timeout");
      }
      // The documented task_cancel operation is a no-op for already finished tasks.
      const control = await created.session.send(`CANCEL ${taskId}`, {
        signal,
        turnPolicy: "queue",
      });
      await bounded(control.result(), 60_000);
      let passed = false;
      while (!signal.aborted) {
        const after = (await child.snapshot({ signal })).events;
        parent = (await created.session.snapshot({ signal })).events;
        try {
          const result = assertProbeOutcome({
            mode,
            marker,
            parentId,
            childId: child.state.sessionId,
            parent,
            before,
            after,
          });
          results.push(result);
          console.log(JSON.stringify(result));
          passed = true;
          break;
        } catch (error) {
          if (signal.aborted) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      requireEvidence(passed, "terminal_evidence_timeout");
    }
    return results;
  } finally {
    let cleanupFailed = false;
    for (const session of owned) {
      try {
        await bounded(session.reset({ reason: "Owned runtime probe completed" }));
        console.log(JSON.stringify({ parentId: session.state.sessionId, status: "retired" }));
      } catch {
        cleanupFailed = true;
      }
    }
    requireEvidence(!cleanupFailed, "cleanup_unconfirmed");
  }
}

if (import.meta.main) {
  const [command, target, credentialsFile] = process.argv.slice(2);
  try {
    requireEvidence(target, "missing_target");
    if (command === "stage") console.log(JSON.stringify(stageRuntimeProbe(process.cwd(), target)));
    else if (command === "verify") {
      requireEvidence(credentialsFile, "missing_credentials_file");
      const token = parseEnv(readFileSync(credentialsFile, "utf8")).VERCEL_OIDC_TOKEN;
      requireEvidence(token, "missing_oidc_token");
      await runRuntimeProbe(target, token);
    } else throw new Error("probe_expected_stage_or_verify");
  } catch (error) {
    // Never print transport exceptions: they can carry headers or model content.
    console.error(
      error instanceof Error && /^probe_[a-z_]+$/.test(error.message)
        ? error.message
        : "probe_failed",
    );
    process.exitCode = 1;
  }
}
