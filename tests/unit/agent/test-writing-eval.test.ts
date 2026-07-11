/** @vitest-environment node */
import {
  readTestWritingFixture,
  resolveTestWritingFixturePath,
  testWritingEvalTimeoutMs,
} from "../../../evals/test-writing/issue-47-red.eval";

describe("test-writing Eve eval fixture", () => {
  it("loads the pinned issue #47 fixture from the repository root", async () => {
    expect(
      resolveTestWritingFixturePath().endsWith("evals/test-writing/fixtures/issue-47.json"),
    ).toBe(true);
    await expect(readTestWritingFixture()).resolves.toMatchObject({
      issueNumber: 47,
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "a".repeat(40),
    });
  });

  it("allows enough time for root routing and an xhigh child session", () => {
    expect(testWritingEvalTimeoutMs).toBeGreaterThanOrEqual(180_000);
  });
});
