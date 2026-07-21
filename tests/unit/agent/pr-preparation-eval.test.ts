/** @vitest-environment node */

import {
  parsePrPreparationSubagentOutput,
  prPreparationEvalTimeoutMs,
  readPrPreparationFixture,
  resolvePrPreparationFixturePath,
} from "../../../evals/pr-preparation/issue-50-pr-intent.eval";

describe("PR preparation Eve eval fixture", () => {
  it("discovers the pinned issue #50 fixture without a live model call", async () => {
    expect(
      resolvePrPreparationFixturePath().endsWith("evals/pr-preparation/fixtures/issue-50.json"),
    ).toBe(true);
    await expect(readPrPreparationFixture()).resolves.toMatchObject({
      issueNumber: 50,
      repositoryFullName: "ncolesummers/loopworks",
      acceptanceCriteria: expect.arrayContaining([
        expect.stringContaining("PR intent artifact"),
        expect.stringContaining("guarded PR creation path"),
        expect.stringContaining("eval coverage"),
      ]),
    });
    expect(prPreparationEvalTimeoutMs).toBeGreaterThanOrEqual(180_000);
  });

  it("decodes serialized typed output and rejects invalid JSON", () => {
    const result = { schemaId: "loopworks.pr_preparation_result.v1", version: 1 };

    expect(parsePrPreparationSubagentOutput(JSON.stringify(result))).toEqual(result);
    expect(parsePrPreparationSubagentOutput("not json")).toBeUndefined();
  });
});
