vi.mock("@/db/client", () => ({ db: {} }));

vi.mock("@/lib/observability/otel", () => ({
  registerLoopworksOtel: vi.fn(),
}));

vi.mock("@/lib/observability/metrics", () => ({
  createControlPlaneGaugeSources: vi.fn(() => ({})),
  registerControlPlaneGaugeMetrics: vi.fn(),
}));

import { register } from "@/instrumentation";
import { configRegistry } from "@/lib/config/registry";

const validProductionValues: Record<string, string> = {
  AUTH_GITHUB_ID: "github-client-id",
  AUTH_GITHUB_SECRET: "github-client-secret",
  AUTH_SECRET: "production-auth-secret",
  DATABASE_URL: "postgres://user:secret@database.example.com/loopworks",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "private-key",
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  LOOPWORKS_EVE_TEST_RECEIPT_SECRET: "receipt-secret",
};

function stubProductionConfig(missingName?: string): void {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  for (const [name, value] of Object.entries(validProductionValues)) {
    vi.stubEnv(name, name === missingName ? "" : value);
  }
}

describe("configuration startup validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing production-required variable before server initialization", async () => {
    stubProductionConfig("AUTH_SECRET");

    await expect(register()).rejects.toThrow(/AUTH_SECRET.*auth/i);
  });

  it.each(
    configRegistry
      .filter((entry) => entry.requiredIn.some((context) => context === "production"))
      .map((entry) => [entry.name, entry.group]),
  )("names missing production variable %s and its %s group", async (name, group) => {
    stubProductionConfig(name);

    await expect(register()).rejects.toThrow(new RegExp(`${name}.*${group}`, "i"));
  });

  it("does not enforce production-only requirements during build, development, or Edge startup", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("NODE_ENV", "production");
    for (const name of Object.keys(validProductionValues)) vi.stubEnv(name, undefined);
    await expect(register()).resolves.toBeUndefined();

    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    await expect(register()).resolves.toBeUndefined();

    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("NODE_ENV", "production");
    await expect(register()).resolves.toBeUndefined();
  });
});
