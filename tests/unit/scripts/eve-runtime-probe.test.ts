/** @vitest-environment node */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it, vi } from "vitest";
import {
  acceptOwnedSession,
  assertProbeOutcome,
  childTurnSettled,
  stageRuntimeProbe,
} from "../../../scripts/eve-runtime-probe";

const event = (type: string, data: object): MessageStreamEvent =>
  ({ type, data, meta: { id: "event", at: "2026-09-06T00:00:00Z" } }) as MessageStreamEvent;
const request = {
  requestId: "approval-1",
  kind: "tool-approval",
  action: {
    callId: "marker-call",
    kind: "tool-call",
    toolName: "approved_marker",
    input: { marker: "marker-1" },
  },
};
function evidence(mode: "approve" | "deny" | "cancel" = "approve") {
  const before = [event("input.requested", { requests: [request] }), event("session.waiting", {})];
  const after =
    mode === "cancel"
      ? [...before, event("turn.cancelled", {}), event("session.waiting", {})]
      : [
          ...before,
          event("input.resolved", {
            resolutions: [
              {
                requestId: request.requestId,
                kind: "tool-approval",
                outcome: mode === "approve" ? "approved" : "denied",
              },
            ],
          }),
          event("action.result", {
            status: mode === "approve" ? "completed" : "rejected",
            result: {
              kind: "tool-result",
              callId: "marker-call",
              toolName: "approved_marker",
              output: mode === "approve" ? { approvedMarker: "marker-1" } : {},
            },
          }),
          event("turn.completed", {}),
          event("session.completed", {}),
        ];
  return {
    mode,
    marker: "marker-1",
    parentId: "parent-1",
    childId: "child-1",
    before,
    after,
    parent: [
      event("actions.requested", {
        actions: [{ kind: "tool-call", toolName: "worker", callId: "delegate-1" }],
      }),
      event("subagent.called", {
        name: "worker",
        sessionId: "parent-1",
        childSessionId: "child-1",
        callId: "delegate-1",
      }),
      event("subagent.completed", {
        subagentName: "worker",
        callId: "delegate-1",
        backgroundTask: { status: "working", taskId: "task-1" },
      }),
      event("input.requested", { requests: [{ ...request, requestId: "task-1:approval-1" }] }),
      event("action.result", {
        status: "completed",
        result: {
          kind: "tool-result",
          toolName: "task_cancel",
          output: {
            tasks: [{ taskId: "task-1", status: mode === "cancel" ? "cancelled" : "completed" }],
          },
        },
      }),
    ],
  };
}

describe("session ownership", () => {
  it("tracks a delayed creation response instead of abandoning it after 15 seconds", async () => {
    vi.useFakeTimers();
    try {
      const owned: object[] = [];
      const session = {};
      let settled = false;
      const pending = acceptOwnedSession(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20_000));
          return { session };
        },
        owned,
        new AbortController().signal,
      ).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(15_001);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;
      expect(owned).toEqual([session]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hosted runtime evidence", () => {
  it("recognizes a completed tool turn while the child session remains reusable", () => {
    const input = evidence();
    input.after.pop();
    input.after.push(event("session.waiting", {}));
    expect(childTurnSettled(input.after)).toBe(true);
    expect(childTurnSettled(input.before)).toBe(false);
    expect(childTurnSettled(input.after.slice(0, 4))).toBe(false);
  });
  it.each(["approve", "deny", "cancel"] as const)("accepts authoritative %s evidence", (mode) => {
    expect(assertProbeOutcome(evidence(mode))).toMatchObject({
      mode,
      taskId: "task-1",
      childId: "child-1",
    });
  });
  it("accepts asynchronous child identity after the working receipt", () => {
    const input = evidence();
    const called = input.parent.splice(1, 1)[0] as MessageStreamEvent;
    input.parent.splice(2, 0, called);
    expect(assertProbeOutcome(input).status).toBe("passed");
  });
  it("rejects a forwarded approval associated with a different task", () => {
    const input = evidence();
    const index = input.parent.findIndex((e) => e.type === "input.requested");
    input.parent[index] = event("input.requested", {
      requests: [{ ...request, requestId: "wrong:approval-1" }],
    });
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it("accepts authoritative task cancellation while an idle child emits no new turn", () => {
    const input = evidence("cancel");
    input.after = [...input.before];
    expect(assertProbeOutcome(input).status).toBe("passed");
  });
  it("rejects parent evidence reordered before admission", () => {
    const input = evidence();
    input.parent.reverse();
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it("rejects cancellation before the child parked for approval", () => {
    const input = evidence("cancel");
    input.after.unshift(input.after.splice(2, 1)[0] as MessageStreamEvent);
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it("rejects admission receipts without terminal child evidence", () => {
    const input = evidence();
    input.after = input.before;
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it("rejects action execution before approval", () => {
    const input = evidence();
    input.before.push(input.after[3] as MessageStreamEvent);
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it("rejects the wrong parent, child, marker, request or task", () => {
    for (const key of ["parentId", "childId", "marker"] as const) {
      expect(() => assertProbeOutcome({ ...evidence(), [key]: "wrong" })).toThrow();
    }
    const input = evidence();
    input.after[2] = event("input.resolved", {
      resolutions: [{ requestId: "wrong", outcome: "approved" }],
    });
    expect(() => assertProbeOutcome(input)).toThrow();
    const wrongTask = evidence();
    wrongTask.parent.pop();
    expect(() => assertProbeOutcome(wrongTask)).toThrow();
  });
  it("rejects a success result ordered before the accepted approval", () => {
    const input = evidence();
    [input.after[2], input.after[3]] = [
      input.after[3] as MessageStreamEvent,
      input.after[2] as MessageStreamEvent,
    ];
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it.each(["turn.failed", "session.failed"])("rejects %s even with later success", (type) => {
    const input = evidence();
    input.after.push(event(type, {}));
    expect(() => assertProbeOutcome(input)).toThrow();
  });
  it("rejects successful execution after denial or cancellation", () => {
    for (const mode of ["deny", "cancel"] as const) {
      const input = evidence(mode);
      input.after.push(evidence().after[3] as MessageStreamEvent);
      expect(() => assertProbeOutcome(input)).toThrow();
    }
  });
});

describe("isolated staging", () => {
  it("copies the locked graph and patches without app tools, credentials, or migration scripts", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "loopworks-probe-test-"));
    try {
      const destination = path.join(parent, "stage");
      const identity = stageRuntimeProbe(process.cwd(), destination);
      const manifest = JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"));
      const root = JSON.parse(readFileSync("package.json", "utf8"));
      expect(manifest.dependencies).toEqual(root.dependencies);
      expect(manifest.devDependencies).toEqual(root.devDependencies);
      expect(manifest.scripts).toEqual({ build: "eve build" });
      expect(readFileSync(path.join(destination, "bun.lock"), "utf8")).toBe(
        readFileSync("bun.lock", "utf8"),
      );
      expect(identity.eve).toBe("0.51.0");
      expect(identity.lockSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(() => readFileSync(path.join(destination, ".env.local"))).toThrow();
      expect(() =>
        readFileSync(path.join(destination, "agent/tools/record_plan_artifact.ts")),
      ).toThrow();
      expect(() => stageRuntimeProbe(process.cwd(), destination)).toThrow();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
