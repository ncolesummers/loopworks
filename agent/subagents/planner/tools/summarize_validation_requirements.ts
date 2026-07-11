import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Map acceptance criteria to deterministic validation gates.",
  inputSchema: z.object({ acceptanceCriteria: z.array(z.string().min(1)).min(1) }),
  execute(input) {
    return {
      gates: input.acceptanceCriteria.map((acceptanceCriterion, index) => ({
        acceptanceCriterion,
        key: `ac-${index + 1}`,
        validation: "focused unit/eval coverage required before review",
      })),
      requiredCommands: ["bun test tests/unit/agent", "bunx eve eval --list"],
    };
  },
});
