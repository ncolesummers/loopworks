import { defineTool } from "eve/tools";
import { z } from "zod";

const validationInputSchema = z.object({
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});

export default defineTool({
  description:
    "Map acceptance criteria to deterministic validation gates for the planning artifact.",
  inputSchema: validationInputSchema,
  execute(input) {
    return {
      gates: input.acceptanceCriteria.map((acceptanceCriterion, index) => ({
        acceptanceCriterion,
        key: `ac-${index + 1}`,
        validation: "focused unit/eval coverage required before review",
      })),
      requiredCommands: [
        "bun test tests/unit/agent/planning-agent.test.ts tests/unit/agent/planning-tools.test.ts tests/unit/agent/planning-fixture.test.ts tests/unit/agent/planning-observability.test.ts",
        "bunx eve eval --list",
      ],
    };
  },
});
