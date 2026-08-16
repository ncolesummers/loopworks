/** @vitest-environment node */

import { runDatabaseDoctor } from "../../../scripts/database-doctor";
import {
  createNativePostgresTestDatabase,
  type NativePostgresTestDatabase,
} from "../../helpers/native-postgres";

describe("database doctor on native PostgreSQL", () => {
  let database: NativePostgresTestDatabase;

  beforeEach(async () => {
    database = await createNativePostgresTestDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.close();
  });

  it("reports the migrated loopworks_e2e target exactly current without changing metadata", async () => {
    const before = await database.client<{ createdAt: number; hash: string }[]>`
      SELECT hash, created_at AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at, id
    `;
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((message) => logs.push(String(message)));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((message) => errors.push(String(message)));

    const exitCode = await runDatabaseDoctor({
      DATABASE_URL: database.url,
      NODE_ENV: "development",
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join(" ")).toContain("Migrations: pass (exactly current)");
    const after = await database.client<{ createdAt: number; hash: string }[]>`
      SELECT hash, created_at AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at, id
    `;
    expect(after).toEqual(before);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
