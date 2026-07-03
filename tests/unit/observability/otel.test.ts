/** @vitest-environment node */
import {
  buildLoopworksResourceAttributes,
  createLoopworksOtelConfig,
  resolveLoopworksOtelMode,
} from "@/lib/observability/otel";

describe("Loopworks OTel configuration", () => {
  it("builds stable resource attributes for Vercel preview runtime context", () => {
    expect(
      buildLoopworksResourceAttributes({
        NODE_ENV: "production",
        NEXT_RUNTIME: "nodejs",
        VERCEL: "1",
        VERCEL_DEPLOYMENT_ID: "dpl_preview_123",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: "abc123",
        VERCEL_GIT_REPO_OWNER: "ncolesummers",
        VERCEL_GIT_REPO_SLUG: "loopworks",
        VERCEL_REGION: "iad1",
      }),
    ).toEqual({
      "deployment.environment": "preview",
      "deployment.environment.name": "preview",
      "deployment.id": "dpl_preview_123",
      "loopworks.runtime": "nodejs",
      "service.name": "loopworks",
      "service.namespace": "loopworks",
      "vcs.ref.head.revision": "abc123",
      "vcs.repository.name": "ncolesummers/loopworks",
      "vercel.environment": "preview",
      "vercel.region": "iad1",
    });
  });

  it("detects local-safe mode until OTLP exporter variables are configured", () => {
    expect(resolveLoopworksOtelMode({ NODE_ENV: "development" })).toBe("local-safe");
    expect(
      resolveLoopworksOtelMode({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.axiom.co",
      }),
    ).toBe("otlp-configured");
    expect(
      resolveLoopworksOtelMode({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://api.axiom.co/v1/traces",
      }),
    ).toBe("otlp-configured");
  });

  it("creates a @vercel/otel config with service name and resource attributes", () => {
    expect(
      createLoopworksOtelConfig({
        NODE_ENV: "test",
        NEXT_RUNTIME: "nodejs",
      }),
    ).toEqual({
      attributes: {
        "deployment.environment": "test",
        "deployment.environment.name": "test",
        "loopworks.runtime": "nodejs",
        "service.name": "loopworks",
        "service.namespace": "loopworks",
      },
      serviceName: "loopworks",
      spanProcessors: [],
    });
  });

  it("keeps local-safe mode free of metric exporters until OTLP metrics are configured", () => {
    const localConfig = createLoopworksOtelConfig({
      NODE_ENV: "development",
    });

    expect(localConfig).not.toHaveProperty("metricReader");
    expect(localConfig).toMatchObject({
      spanProcessors: [],
    });

    expect(
      createLoopworksOtelConfig({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://api.axiom.co/v1/metrics",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS:
          "authorization=Bearer%20token,x-axiom-metrics-dataset=loopworks-metrics",
        OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/protobuf",
      }),
    ).toEqual(
      expect.objectContaining({
        metricReader: expect.any(Object),
      }),
    );
  });

  it("enables trace export only when OTLP trace configuration is present", () => {
    expect(
      createLoopworksOtelConfig({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://api.axiom.co/v1/traces",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS:
          "authorization=Bearer%20token,x-axiom-dataset=loopworks-events",
      }),
    ).not.toHaveProperty("spanProcessors");
  });
});
