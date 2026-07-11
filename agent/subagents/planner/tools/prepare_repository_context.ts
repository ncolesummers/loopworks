import { eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { db } from "@/db/client";
import { loopRuns, repositories } from "@/db/schema";

import { resolvePlanningAgentFixtureMode } from "../../../lib/fixture-mode";

const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const revision = z
  .object({
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    ref: z
      .string()
      .regex(/^[A-Za-z0-9._/-]+$/)
      .optional(),
  })
  .optional();

export default defineTool({
  description: "Prepare an isolated repository checkout and return its exact pinned commit.",
  inputSchema: z.object({
    runId: z.string().uuid().optional(),
    repositoryFullName: repositoryName.optional(),
    revision,
  }),
  outputSchema: z.object({
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    fixtureMode: z.boolean(),
  }),
  async execute(input, ctx) {
    const fixtureMode = resolvePlanningAgentFixtureMode().enabled;
    if (fixtureMode) {
      return { commitSha: input.revision?.commitSha ?? "a".repeat(40), fixtureMode: true };
    }
    if (!input.runId)
      throw new Error("Production repository preparation requires a durable run ID.");
    const [boundRepository] = await db
      .select({ fullName: repositories.fullName })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);
    if (!boundRepository) throw new Error("Run repository binding was not found.");
    if (input.repositoryFullName && input.repositoryFullName !== boundRepository.fullName) {
      throw new Error("Requested repository does not match the durable run.");
    }
    const repositoryFullName = boundRepository.fullName;
    const sandbox = await ctx.getSandbox();
    await sandbox.setNetworkPolicy({ allow: ["github.com", "objects.githubusercontent.com"] });
    try {
      const clone = await sandbox.run({
        command: `git clone --filter=blob:none 'https://github.com/${repositoryFullName}.git' repo`,
        abortSignal: AbortSignal.timeout(120_000),
      });
      if (clone.exitCode !== 0) throw new Error("Repository checkout failed.");
      const target = input.revision?.commitSha ?? input.revision?.ref;
      if (target) {
        const checkout = await sandbox.run({
          command: `cd repo && git checkout --detach '${target}'`,
          abortSignal: AbortSignal.timeout(60_000),
        });
        if (checkout.exitCode !== 0) throw new Error("Repository revision checkout failed.");
      }
      const resolved = await sandbox.run({
        command: "cd repo && git rev-parse HEAD",
        abortSignal: AbortSignal.timeout(10_000),
      });
      const commitSha = resolved.stdout.trim();
      if (resolved.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(commitSha)) {
        throw new Error("Repository revision could not be pinned.");
      }
      await sandbox.run({
        command: "mkdir -p .loopworks",
        abortSignal: AbortSignal.timeout(5_000),
      });
      await sandbox.writeTextFile({ path: ".loopworks/repository-commit", content: commitSha });
      return { commitSha, fixtureMode: false };
    } finally {
      await sandbox.setNetworkPolicy("deny-all");
    }
  },
});
