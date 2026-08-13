import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  patchedDependencies?: Record<string, string>;
};

const repositoryRoot = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8")) as T;
}

describe("OpenTelemetry 2 toolchain", () => {
  it("keeps the direct packages on one compatible stable and experimental family", () => {
    const manifest = readJson<PackageManifest>("package.json");
    const directPackages = Object.fromEntries(
      Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([name]) =>
        name.startsWith("@opentelemetry/"),
      ),
    );

    expect(directPackages).toEqual({
      "@opentelemetry/api": "^1.9.0",
      "@opentelemetry/context-async-hooks": "^2.10.0",
      "@opentelemetry/core": "^2.10.0",
      "@opentelemetry/exporter-metrics-otlp-proto": "^0.221.0",
      "@opentelemetry/instrumentation": "^0.221.0",
      "@opentelemetry/sdk-metrics": "^2.10.0",
      "@opentelemetry/sdk-trace-base": "^2.10.0",
    });
    expect(manifest.dependencies?.["@vercel/otel"]).toBe("2.1.3");
    expect(manifest.patchedDependencies?.["@vercel/otel@2.1.3"]).toBe(
      "patches/@vercel%2Fotel@2.1.3.patch",
    );
  });

  it("locks one reviewed OpenTelemetry dependency family", () => {
    const lockfile = readFileSync(path.join(repositoryRoot, "bun.lock"), "utf8");
    const resolvedPackages = [...lockfile.matchAll(/"(@opentelemetry\/[^"]+@[^"]+)"/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined)
      .sort();

    expect([...new Set(resolvedPackages)]).toEqual([
      "@opentelemetry/api-logs@0.221.0",
      "@opentelemetry/api@1.9.1",
      "@opentelemetry/context-async-hooks@2.10.0",
      "@opentelemetry/core@2.10.0",
      "@opentelemetry/exporter-metrics-otlp-http@0.221.0",
      "@opentelemetry/exporter-metrics-otlp-proto@0.221.0",
      "@opentelemetry/instrumentation@0.221.0",
      "@opentelemetry/otlp-exporter-base@0.221.0",
      "@opentelemetry/otlp-transformer@0.221.0",
      "@opentelemetry/resources@2.10.0",
      "@opentelemetry/sdk-logs@0.221.0",
      "@opentelemetry/sdk-metrics@2.10.0",
      "@opentelemetry/sdk-trace-base@2.10.0",
      "@opentelemetry/sdk-trace@2.10.0",
      "@opentelemetry/semantic-conventions@1.43.0",
    ]);
  });

  it.each([{ conditions: [] }, { conditions: ["--conditions=edge"] }])(
    "enforces patched baggage limits through the registered Vercel distribution ($conditions)",
    ({ conditions }) => {
      const script = `
      import { context, propagation, trace } from "@opentelemetry/api";
      import { registerLoopworksOtel } from "./src/lib/observability/otel.ts";

      const rootSpanContext = {
        traceId: "1".repeat(32),
        spanId: "2".repeat(16),
        traceFlags: 1,
      };
      globalThis[Symbol.for("@vercel/request-context")] = {
        get() { return { telemetry: { rootSpanContext } }; },
      };
      const getter = {
        get(carrier, key) { return carrier[key]; },
        keys(carrier) { return Object.keys(carrier); },
      };
      registerLoopworksOtel({ NODE_ENV: "test" });
      const manyEntries = Array.from(
        { length: 181 },
        (_, index) => "key" + index + "=value",
      ).join(",");
      const manyContext = propagation.extract(context.active(), { baggage: manyEntries }, getter);
      const oversizedContext = propagation.extract(
        context.active(),
        { baggage: "oversized=" + "x".repeat(4097) + ",valid=value" },
        getter,
      );
      const aggregateContext = propagation.extract(
        context.active(),
        {
          baggage: [
            "first=" + "x".repeat(4080),
            "second=" + "y".repeat(4080),
            "third=12345678901234567890",
          ],
        },
        getter,
      );
      const arrayContext = propagation.extract(
        context.active(),
        { baggage: [manyEntries, "extra=value"] },
        getter,
      );
      const runtimeContext = propagation.extract(context.active(), {}, getter);
      console.log(JSON.stringify({
        aggregateEntries: propagation.getBaggage(aggregateContext)?.getAllEntries().map(([key]) => key),
        arrayEntryCount: propagation.getBaggage(arrayContext)?.getAllEntries().length ?? 0,
        entryCount: propagation.getBaggage(manyContext)?.getAllEntries().length ?? 0,
        oversized: propagation.getBaggage(oversizedContext)?.getEntry("oversized")?.value,
        runtimeSpanContext: trace.getSpanContext(runtimeContext),
        valid: propagation.getBaggage(oversizedContext)?.getEntry("valid")?.value,
      }));
    `;
      const result = spawnSync("bun", [...conditions, "--eval", script], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          NEXT_RUNTIME: "nodejs",
          NODE_ENV: "test",
          PATH: process.env.PATH,
        },
      });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        aggregateEntries: ["first", "second"],
        arrayEntryCount: 180,
        entryCount: 180,
        runtimeSpanContext: {
          isRemote: true,
          spanId: "2".repeat(16),
          traceFlags: 1,
          traceId: "1".repeat(32),
        },
        valid: "value",
      });
    },
  );

  it("removes the remediated core advisory without widening another exception", () => {
    const scannerConfig = readFileSync(path.join(repositoryRoot, "osv-scanner.toml"), "utf8");

    expect(scannerConfig).not.toContain("GHSA-8988-4f7v-96qf");
    expect(scannerConfig.match(/^\[\[IgnoredVulns\]\]$/gm)).toHaveLength(3);
  });
});
