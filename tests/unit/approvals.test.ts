import {
  ApprovalTransitionError,
  canTransitionApproval,
  transitionApproval,
} from "@/lib/approvals";

describe("approval transitions", () => {
  it("allows requested approvals to move to approved", () => {
    expect(canTransitionApproval("requested", "approve")).toBe(true);
    expect(
      transitionApproval({
        currentStatus: "requested",
        action: "approve",
        actorId: "user_123",
        occurredAt: new Date("2026-06-19T00:00:00.000Z"),
      }),
    ).toEqual({
      from: "requested",
      to: "approved",
      action: "approve",
      actorId: "user_123",
      occurredAt: "2026-06-19T00:00:00.000Z",
    });
  });

  it("rejects invalid transitions", () => {
    expect(() =>
      transitionApproval({
        currentStatus: "approved",
        action: "reject",
        actorId: "user_123",
      }),
    ).toThrow(ApprovalTransitionError);
  });

  it("allows requested approvals to be bypassed with actor attribution", () => {
    expect(canTransitionApproval("requested", "bypass")).toBe(true);
    expect(
      transitionApproval({
        currentStatus: "requested",
        action: "bypass",
        actorId: "ncolesummers",
        note: "Emergency operator override.",
        occurredAt: new Date("2026-07-02T16:08:00.000Z"),
      }),
    ).toEqual({
      from: "requested",
      to: "bypassed",
      action: "bypass",
      actorId: "ncolesummers",
      occurredAt: "2026-07-02T16:08:00.000Z",
      note: "Emergency operator override.",
    });
  });
});
