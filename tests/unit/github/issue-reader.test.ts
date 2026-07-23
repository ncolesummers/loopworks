/** @vitest-environment node */
import { createGitHubIssueReader } from "@/lib/github/issue-reader";

describe("GitHub issue reader", () => {
  it("reads and normalizes issue state without exposing mutation methods", async () => {
    const get = vi.fn(async () => ({
      data: {
        labels: [{ name: "Agent-Ready" }, { name: "AREA:LOOPS" }, "Priority:P1"],
        state: "open" as const,
      },
    }));
    const reader = createGitHubIssueReader({
      getInstallationClient: vi.fn(async () => ({ rest: { issues: { get } } })),
    });

    await expect(
      reader.getIssue({
        installationId: 95_001,
        issueNumber: 95,
        owner: "ncolesummers",
        repo: "loopworks",
      }),
    ).resolves.toEqual({
      labels: ["agent-ready", "area:loops", "priority:p1"],
      state: "open",
    });
    expect(get).toHaveBeenCalledWith({
      issue_number: 95,
      owner: "ncolesummers",
      repo: "loopworks",
    });
    expect(Object.keys(reader)).toEqual(["getIssue"]);
  });
});
