import { defineTool } from "eve/tools";
import { z } from "zod";

import { extractAcceptanceCriteria } from "../planning-agent";

const readIssueContextInputSchema = z.object({
  body: z.string().default(""),
  labels: z.array(z.string()).default([]),
  milestone: z.string().nullable().default(null),
  repositoryFullName: z.string().min(1),
  title: z.string().min(1),
  issueNumber: z.number().int().positive(),
  url: z.url().optional(),
});

export default defineTool({
  description:
    "Read supplied GitHub issue context and return normalized planning metadata without mutating GitHub.",
  inputSchema: readIssueContextInputSchema,
  execute(input) {
    return {
      acceptanceCriteria: extractAcceptanceCriteria(input.body),
      issue: {
        labels: input.labels,
        milestone: input.milestone,
        number: input.issueNumber,
        repositoryFullName: input.repositoryFullName,
        title: input.title,
        url:
          input.url ?? `https://github.com/${input.repositoryFullName}/issues/${input.issueNumber}`,
      },
      source: "supplied_issue_context",
    };
  },
});
