/** @vitest-environment node */
import { migrate } from "drizzle-orm/pglite/migrator";

import { loops, repositories } from "@/db/schema";
import { createPgliteTestDatabase, pgliteTestHookTimeoutMs } from "../../helpers/pglite";

describe("PGlite test database lifecycle", () => {
  it(
    "removes related application rows and permits unique fixtures to be reused",
    async () => {
      const context = await createPgliteTestDatabase();

      try {
        const repositoryFixture = {
          fullName: "ncolesummers/loopworks",
          githubRepoId: 40_000_001,
          name: "loopworks",
          owner: "ncolesummers",
        };
        const [repository] = await context.db
          .insert(repositories)
          .values(repositoryFixture)
          .returning();
        if (!repository) throw new Error("Expected repository fixture.");

        await context.db.insert(loops).values({
          githubIssueNumber: 40,
          repositoryId: repository.id,
          title: "Harden the PGlite test harness",
        });

        await context.reset();

        expect(await context.db.select().from(loops)).toEqual([]);
        expect(await context.db.select().from(repositories)).toEqual([]);
        await expect(
          context.db.insert(repositories).values(repositoryFixture),
        ).resolves.toBeDefined();
      } finally {
        await context.close();
      }
    },
    pgliteTestHookTimeoutMs,
  );

  it(
    "preserves migration metadata so replay remains a no-op",
    async () => {
      const context = await createPgliteTestDatabase();

      try {
        const before = await context.client.query(
          'SELECT "id", "hash", "created_at" FROM "drizzle"."__drizzle_migrations" ORDER BY "id"',
        );

        await context.reset();
        await migrate(context.db, { migrationsFolder: "drizzle" });

        const after = await context.client.query(
          'SELECT "id", "hash", "created_at" FROM "drizzle"."__drizzle_migrations" ORDER BY "id"',
        );
        expect(after.rows).toEqual(before.rows);
      } finally {
        await context.close();
      }
    },
    pgliteTestHookTimeoutMs,
  );

  it(
    "surfaces reset failures instead of masking an invalid database context",
    async () => {
      const context = await createPgliteTestDatabase();
      await context.close();

      await expect(context.reset()).rejects.toThrow();
    },
    pgliteTestHookTimeoutMs,
  );
});
