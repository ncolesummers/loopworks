/** @vitest-environment node */
import { defaultLoopManifest } from "@/lib/loops/manifest";
import {
  type DevelopmentLoopActiveRun,
  type DevelopmentLoopRunStore,
  reconcileDevelopmentLoopRuns,
} from "@/lib/loops/development-run-reconciliation";

const now = new Date("2026-07-22T16:10:00.000Z");

function activeRun(overrides: Partial<DevelopmentLoopActiveRun> = {}): DevelopmentLoopActiveRun {
  return {
    currentStage: "development",
    currentStepId: "step-95",
    githubIssueNumber: 95,
    installationId: 95001,
    latestStepActivityAt: new Date("2026-07-22T16:09:00.000Z"),
    loopKey: "development-loop",
    repositoryFullName: "ncolesummers/loopworks",
    repositoryName: "loopworks",
    repositoryOwner: "ncolesummers",
    runId: "run-95",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    ...overrides,
  };
}

function manifest(overrides?: {
  enabled?: boolean;
  onDisabled?: "skip_new_runs" | "cancel_running";
  onSuperseded?: "mark_canceled" | "continue_existing";
  silenceThresholdSeconds?: number;
}) {
  return {
    ...defaultLoopManifest,
    loops: defaultLoopManifest.loops.map((loop) =>
      loop.key === "development-loop"
        ? {
            ...loop,
            enabled: overrides?.enabled ?? loop.enabled,
            cancellation: {
              ...loop.cancellation,
              onDisabled: overrides?.onDisabled ?? loop.cancellation.onDisabled,
              onSuperseded: overrides?.onSuperseded ?? loop.cancellation.onSuperseded,
            },
            reconciliation: {
              silenceThresholdSeconds:
                overrides?.silenceThresholdSeconds ?? loop.reconciliation.silenceThresholdSeconds,
            },
          }
        : loop,
    ),
  };
}

function store(input: {
  liveness?: "active" | "inactive" | "unknown";
  runs?: DevelopmentLoopActiveRun[];
}) {
  const finalizeRun = vi.fn(async ({ reason, runId }) => ({
    durationSeconds: 60,
    reason,
    runId,
    status:
      reason === "canceled_by_reconciliation"
        ? ("canceled" as const)
        : reason === "succeeded"
          ? ("succeeded" as const)
          : ("failed" as const),
  }));
  const value: DevelopmentLoopRunStore = {
    finalizeRun,
    getExecutionLiveness: vi.fn(async () => input.liveness ?? "active"),
    listActiveRuns: vi.fn(async () => input.runs ?? [activeRun()]),
  };
  return { finalizeRun, value };
}

function issueReader(input?: { labels?: string[]; state?: "open" | "closed"; throws?: boolean }) {
  return {
    getIssue: vi.fn(async () => {
      if (input?.throws) throw new Error("github_unavailable");
      return {
        labels: input?.labels ?? ["agent-ready", "area:loops"],
        state: input?.state ?? ("open" as const),
      };
    }),
  };
}

describe("development-loop run reconciliation", () => {
  it("leaves a healthy active run untouched and keeps the threshold boundary healthy", async () => {
    const runStore = store({
      runs: [activeRun({ latestStepActivityAt: new Date("2026-07-22T16:05:00.000Z") })],
    });

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest(),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ action: "healthy", runId: "run-95" }),
    ]);
    expect(runStore.finalizeRun).not.toHaveBeenCalled();
  });

  it("changes stall detection when the manifest threshold changes", async () => {
    const run = activeRun({ latestStepActivityAt: new Date("2026-07-22T16:08:00.000Z") });
    const shortStore = store({ runs: [run] });
    const longStore = store({ runs: [run] });

    const short = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest({ silenceThresholdSeconds: 60 }),
      runStore: shortStore.value,
    });
    const long = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest({ silenceThresholdSeconds: 300 }),
      runStore: longStore.value,
    });

    expect(short.outcomes).toEqual([
      expect.objectContaining({ action: "finalized", terminalReason: "stalled" }),
    ]);
    expect(shortStore.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredAt: now,
        reason: "stalled",
        runId: "run-95",
      }),
    );
    expect(long.outcomes).toEqual([expect.objectContaining({ action: "healthy" })]);
  });

  it("terminates an orphaned run as timed out", async () => {
    const runStore = store({ liveness: "inactive" });

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest(),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ action: "finalized", terminalReason: "timed_out" }),
    ]);
  });

  it("fails open when execution liveness is unknown", async () => {
    const runStore = store({ liveness: "unknown" });

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest(),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ action: "liveness_unknown", runId: "run-95" }),
    ]);
    expect(runStore.finalizeRun).not.toHaveBeenCalled();
  });

  it("isolates a throwing liveness provider and continues reconciling later runs", async () => {
    const runs = [activeRun({ runId: "first" }), activeRun({ runId: "second" })];
    const runStore: DevelopmentLoopRunStore = {
      finalizeRun: vi.fn(),
      getExecutionLiveness: vi
        .fn()
        .mockRejectedValueOnce(new Error("liveness unavailable"))
        .mockResolvedValueOnce("active"),
      listActiveRuns: vi.fn(async () => runs),
    };

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest(),
      runStore,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ action: "liveness_unknown", runId: "first" }),
      expect.objectContaining({ action: "healthy", runId: "second" }),
    ]);
  });

  it.each([
    { labels: ["agent-ready"], name: "closed issue", state: "closed" as const },
    { labels: ["area:loops"], name: "removed trigger label", state: "open" as const },
  ])("cancels a run for a $name", async ({ labels, state }) => {
    const runStore = store({ liveness: "inactive" });

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader({ labels, state }),
      manifest: manifest({ onSuperseded: "mark_canceled" }),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({
        action: "finalized",
        policy: expect.objectContaining({ configuredValue: "mark_canceled" }),
        terminalReason: "canceled_by_reconciliation",
      }),
    ]);
  });

  it("honors continue_existing for superseded work", async () => {
    const runStore = store({});

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader({ state: "closed" }),
      manifest: manifest({ onSuperseded: "continue_existing" }),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({
        action: "policy_continued",
        policy: expect.objectContaining({ configuredValue: "continue_existing" }),
      }),
    ]);
    expect(runStore.finalizeRun).not.toHaveBeenCalled();
  });

  it("surfaces continue_existing when local timeout evidence still finalizes the run", async () => {
    const runStore = store({ liveness: "inactive" });

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader({ state: "closed" }),
      manifest: manifest({ onSuperseded: "continue_existing" }),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({
        action: "finalized",
        policy: expect.objectContaining({ configuredValue: "continue_existing" }),
        terminalReason: "timed_out",
      }),
    ]);
  });

  it("keeps a run active when the store rejects stale finalization evidence", async () => {
    const runStore = store({ runs: [activeRun({ latestStepActivityAt: new Date(0) })] });
    runStore.finalizeRun.mockResolvedValueOnce({
      finalized: false,
      reason: "state_changed",
      runId: "run-95",
    } as never);

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest(),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ action: "healthy", runId: "run-95" }),
    ]);
  });

  it.each([
    { action: "finalized", onDisabled: "cancel_running" as const },
    { action: "policy_continued", onDisabled: "skip_new_runs" as const },
  ])("honors disabled-loop policy $onDisabled", async ({ action, onDisabled }) => {
    const runStore = store({});

    const result = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: issueReader(),
      manifest: manifest({ enabled: false, onDisabled }),
      runStore: runStore.value,
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({
        action,
        policy: expect.objectContaining({ configuredValue: onDisabled }),
      }),
    ]);
  });

  it("keeps tracker failures from canceling runs but still applies local timeout evidence", async () => {
    const healthyStore = store({});
    const orphanStore = store({ liveness: "inactive" });
    const failingReader = issueReader({ throws: true });

    const healthy = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: failingReader,
      manifest: manifest(),
      runStore: healthyStore.value,
    });
    const orphan = await reconcileDevelopmentLoopRuns({
      clock: () => now,
      issueReader: failingReader,
      manifest: manifest(),
      runStore: orphanStore.value,
    });

    expect(healthy.outcomes).toEqual([expect.objectContaining({ action: "issue_refresh_failed" })]);
    expect(orphan.outcomes).toEqual([
      expect.objectContaining({ action: "finalized", terminalReason: "timed_out" }),
    ]);
  });
});
