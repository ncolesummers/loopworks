/** @vitest-environment node */
import { readActiveLoopRunId } from "@agent/lib/active-loop-run";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("active Loop run authority", () => {
  it("uses only the immutable initiating principal claim", () => {
    expect(
      readActiveLoopRunId({
        current: {
          attributes: { "loopworks.run_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        },
        initiator: { attributes: { "loopworks.run_id": runId } },
      }),
    ).toBe(runId);
  });

  it.each([
    ["missing initiator", { current: null, initiator: null }],
    ["missing claim", { current: null, initiator: { attributes: {} } }],
    [
      "multi-valued claim",
      { current: null, initiator: { attributes: { "loopworks.run_id": [runId] } } },
    ],
    [
      "malformed claim",
      { current: null, initiator: { attributes: { "loopworks.run_id": "not-a-run" } } },
    ],
  ])("fails closed for %s", (_label, auth) => {
    expect(readActiveLoopRunId(auth)).toBeUndefined();
  });
});
