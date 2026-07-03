import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PeriodicExportingMetricReader, type MetricReader } from "@opentelemetry/sdk-metrics";
import { registerOTel, type Configuration } from "@vercel/otel";

export const loopworksServiceName = "loopworks";

type Env = Record<string, string | undefined>;

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
  return firstPresent(env.VERCEL_ENV, env.NODE_ENV) ?? "development";
}

function resolveRepositoryName(env: Env): string | undefined {
  if (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG) {
    return `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`;
  }

  return env.VERCEL_GIT_REPO_SLUG;
}

export function buildLoopworksResourceAttributes(env: Env = process.env) {
  const deploymentEnvironment = resolveDeploymentEnvironment(env);

  return compactResourceAttributes({
    "deployment.environment": deploymentEnvironment,
    "deployment.environment.name": deploymentEnvironment,
    "deployment.id": env.VERCEL_DEPLOYMENT_ID,
    "loopworks.runtime": firstPresent(env.NEXT_RUNTIME, "nodejs"),
    "service.name": loopworksServiceName,
    "service.namespace": "loopworks",
    "vcs.ref.head.revision": env.VERCEL_GIT_COMMIT_SHA,
    "vcs.repository.name": resolveRepositoryName(env),
    "vercel.environment": env.VERCEL_ENV,
    "vercel.region": env.VERCEL_REGION,
  });
}

export function resolveLoopworksOtelMode(env: Env = process.env): LoopworksOtelMode {
  return firstPresent(
    env.OTEL_EXPORTER_OTLP_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
  )
    ? "otlp-configured"
    : "local-safe";
}

function hasOtlpTraceConfig(env: Env): boolean {
  return Boolean(
    firstPresent(env.OTEL_EXPORTER_OTLP_ENDPOINT, env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
  );
}

function hasOtlpMetricsConfig(env: Env): boolean {
  return Boolean(
    firstPresent(env.OTEL_EXPORTER_OTLP_ENDPOINT, env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT),
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
