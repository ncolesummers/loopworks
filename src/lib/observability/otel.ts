import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { type MetricReader, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { type Configuration, registerOTel } from "@vercel/otel";

import { type ConfigName, readSuppliedRawConfig } from "@/lib/config/registry";

export const loopworksServiceName = "loopworks";

type Env = Record<string, string | undefined>;

function envValue(name: ConfigName, env: Env): string | undefined {
  return readSuppliedRawConfig(name, env);
}

export type LoopworksOtelMode = "local-safe" | "otlp-configured";

function firstPresent(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function compactResourceAttributes(attributes: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
}

function resolveDeploymentEnvironment(env: Env): string {
  return firstPresent(envValue("VERCEL_ENV", env), envValue("NODE_ENV", env)) ?? "development";
}

function resolveRepositoryName(env: Env): string | undefined {
  const owner = envValue("VERCEL_GIT_REPO_OWNER", env);
  const slug = envValue("VERCEL_GIT_REPO_SLUG", env);
  if (owner && slug) {
    return `${owner}/${slug}`;
  }

  return slug;
}

export function buildLoopworksResourceAttributes(env: Env = process.env) {
  const deploymentEnvironment = resolveDeploymentEnvironment(env);

  return compactResourceAttributes({
    "deployment.environment": deploymentEnvironment,
    "deployment.environment.name": deploymentEnvironment,
    "deployment.id": envValue("VERCEL_DEPLOYMENT_ID", env),
    "loopworks.runtime": firstPresent(envValue("NEXT_RUNTIME", env), "nodejs"),
    "service.name": loopworksServiceName,
    "service.namespace": "loopworks",
    "vcs.ref.head.revision": envValue("VERCEL_GIT_COMMIT_SHA", env),
    "vcs.repository.name": resolveRepositoryName(env),
    "vercel.environment": envValue("VERCEL_ENV", env),
    "vercel.region": envValue("VERCEL_REGION", env),
  });
}

export function resolveLoopworksOtelMode(env: Env = process.env): LoopworksOtelMode {
  return firstPresent(
    envValue("OTEL_EXPORTER_OTLP_ENDPOINT", env),
    envValue("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", env),
    envValue("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", env),
    envValue("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", env),
  )
    ? "otlp-configured"
    : "local-safe";
}

function hasOtlpTraceConfig(env: Env): boolean {
  return Boolean(
    firstPresent(
      envValue("OTEL_EXPORTER_OTLP_ENDPOINT", env),
      envValue("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", env),
    ),
  );
}

function hasOtlpMetricsConfig(env: Env): boolean {
  return Boolean(
    firstPresent(
      envValue("OTEL_EXPORTER_OTLP_ENDPOINT", env),
      envValue("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", env),
    ),
  );
}

export function createLoopworksMetricReader(env: Env = process.env): MetricReader | undefined {
  if (!hasOtlpMetricsConfig(env)) {
    return undefined;
  }

  return new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  });
}

export function createLoopworksOtelConfig(env: Env = process.env): Configuration {
  const metricReader = createLoopworksMetricReader(env);

  return {
    attributes: buildLoopworksResourceAttributes(env),
    ...(metricReader ? { metricReader } : {}),
    serviceName: loopworksServiceName,
    ...(hasOtlpTraceConfig(env) ? {} : { spanProcessors: [] }),
  };
}

export function registerLoopworksOtel(env: Env = process.env): void {
  registerOTel(createLoopworksOtelConfig(env));
}
