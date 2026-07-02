/** @vitest-environment node */
import { auth } from "@/auth";
import {
  handleApprovalTransitionPost,
  POST as postApprovalTransition,
} from "@/app/api/approvals/transition/route";
import { approvalTransitionEvents, approvals, loopRuns, repositories } from "@/db/schema";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth as unknown as () => Promise<Session | null>);

describe("approval transition API", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    authMock.mockReset();
    vi.unstubAllEnvs();
    await context?.close();
  });

  async function insertRequestedApproval() {
    const repositoryId = "12000000-0000-4000-8000-000000000001";
    const runId = "12000000-0000-4000-8000-000000000002";
    const approvalId = "12000000-0000-4000-8000-000000000003";

    await context.db.insert(repositories).values({
      id: repositoryId,
      githubRepoId: 12_000_001,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
    });
    await context.db.insert(loopRuns).values({
      id: runId,
      repositoryId,
      loopKey: "development-loop",
      githubIssueNumber: 12,
      status: "waiting_for_approval",
      currentStage: "approval",
    });
    await context.db.insert(approvals).values({
      id: approvalId,
      runId,
      scope: "pr-write",
      status: "requested",
      requestedBy: "eve-builder-agent",
      requestedAt: new Date("2026-07-02T16:00:00.000Z"),
      note: "Approval required before write path advances.",
    });

    return { approvalId, runId };
  }

  function transitionRequest(input: {
    action: "approve" | "reject" | "bypass" | "apply";
    approvalId: string;
    expectedStatus: string;
    note?: string;
  }) {
    return new Request("https://loopworks.local/api/approvals/transition", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  it("attributes and persists approval transitions to the authenticated GitHub login", async () => {
    const { approvalId } = await insertRequestedApproval();
    vi.stubEnv("LOOPWORKS_ALLOWED_GITHUB_USERS", "ncolesummers");
    authMock.mockResolvedValue({
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        name: "Nathan Summers",
        email: "nathan@example.com",
        githubLogin: "ncolesummers",
      },
    });

    const response = await handleApprovalTransitionPost(
      transitionRequest({
        approvalId,
        expectedStatus: "requested",
        action: "approve",
        note: "Evidence checked.",
      }),
      {
        database: context.db as unknown as ApprovalTransitionDatabase,
        now: () => new Date("2026-07-02T16:05:00.000Z"),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transition: {
        from: "requested",
        to: "approved",
        action: "approve",
        actorId: "ncolesummers",
        occurredAt: "2026-07-02T16:05:00.000Z",
        note: "Evidence checked.",
      },
    });

    const approvalRows = await context.db.select().from(approvals);
    expect(approvalRows[0]).toMatchObject({
      status: "approved",
      resolvedBy: "ncolesummers",
      note: "Evidence checked.",
    });
    expect(approvalRows[0].resolvedAt).toEqual(new Date("2026-07-02T16:05:00.000Z"));

    const eventRows = await context.db.select().from(approvalTransitionEvents);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]).toMatchObject({
      action: "approve",
      actorId: "ncolesummers",
      fromStatus: "requested",
      toStatus: "approved",
    });
    expect(eventRows[0].metadata).toMatchObject({
      expectedStatus: "requested",
      authMode: "github",
    });
  });

  it("rejects stale expected approval state without mutating the row", async () => {
    const { approvalId } = await insertRequestedApproval();
    vi.stubEnv("LOOPWORKS_ALLOWED_GITHUB_USERS", "ncolesummers");
    authMock.mockResolvedValue({
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        name: "Nathan Summers",
        email: "nathan@example.com",
        githubLogin: "ncolesummers",
      },
    });

    const response = await handleApprovalTransitionPost(
      transitionRequest({
        approvalId,
        expectedStatus: "approved",
        action: "apply",
      }),
      {
        database: context.db as unknown as ApprovalTransitionDatabase,
        now: () => new Date("2026-07-02T16:05:00.000Z"),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      actualStatus: "requested",
      expectedStatus: "approved",
    });

    const [approvalRow] = await context.db.select().from(approvals);
    expect(approvalRow.status).toBe("requested");
    expect(await context.db.select().from(approvalTransitionEvents)).toHaveLength(0);
  });

  it("allows only one concurrent transition from the same expected state", async () => {
    const { approvalId } = await insertRequestedApproval();
    vi.stubEnv("LOOPWORKS_ALLOWED_GITHUB_USERS", "ncolesummers");
    authMock.mockResolvedValue({
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        name: "Nathan Summers",
        email: "nathan@example.com",
        githubLogin: "ncolesummers",
      },
    });

    const responses = await Promise.all([
      handleApprovalTransitionPost(
        transitionRequest({
          approvalId,
          expectedStatus: "requested",
          action: "approve",
          note: "Approve wins.",
        }),
        {
          database: context.db as unknown as ApprovalTransitionDatabase,
          now: () => new Date("2026-07-02T16:06:00.000Z"),
        },
      ),
      handleApprovalTransitionPost(
        transitionRequest({
          approvalId,
          expectedStatus: "requested",
          action: "reject",
          note: "Reject loses if stale.",
        }),
        {
          database: context.db as unknown as ApprovalTransitionDatabase,
          now: () => new Date("2026-07-02T16:06:00.000Z"),
        },
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const [approvalRow] = await context.db.select().from(approvals);
    expect(["approved", "rejected"]).toContain(approvalRow.status);
    expect(await context.db.select().from(approvalTransitionEvents)).toHaveLength(1);
  });

  it("rejects real authenticated sessions that are missing persisted GitHub login", async () => {
    const { approvalId } = await insertRequestedApproval();
    authMock.mockResolvedValue({
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        name: "Nathan Summers",
        email: "nathan@example.com",
      },
    });

    const response = await postApprovalTransition(
      transitionRequest({
        approvalId,
        expectedStatus: "requested",
        action: "approve",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub identity is not authorized.",
      reason: "missing_github_login",
    });
  });
});
