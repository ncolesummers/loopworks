/** @vitest-environment node */
import {
  implementationEvalTimeoutMs,
  parseImplementationSubagentOutput,
  readImplementationFixture,
  resolveImplementationFixturePath,
} from "../../../evals/implementation/issue-48-green.eval";

describe("implementation Eve eval fixture", () => {
  it("discovers the pinned issue #48 fixture without a live model call", async () => {
    expect(
      resolveImplementationFixturePath().endsWith("evals/implementation/fixtures/issue-48.json"),
    ).toBe(true);
    await expect(readImplementationFixture()).resolves.toMatchObject({
      issueNumber: 48,
      repositoryFullName: "ncolesummers/loopworks",
      acceptanceCriteria: expect.arrayContaining([
        expect.stringContaining("exact hashed test patch"),
        expect.stringContaining("fixtures and seed data are reused"),
      ]),
    });
    expect(implementationEvalTimeoutMs).toBeGreaterThanOrEqual(180_000);
  });

  it("decodes the JSON-string output shape emitted by subagent.completed", () => {
    const result = { schemaId: "loopworks.implementation_result.v1", version: 1 };

    expect(parseImplementationSubagentOutput(JSON.stringify(result))).toEqual(result);
    expect(parseImplementationSubagentOutput("not json")).toBeUndefined();
  });
});
