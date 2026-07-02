import type { ReactNode } from "react";

import { FixtureUnavailableNotice } from "@/components/portal/fixture-unavailable";
import { createRequestLogger, type LoopworksLogger } from "@/lib/observability/logger";
import { isProductionRuntime } from "@/lib/runtime";

/**
 * Wraps portal pages that are still backed by static fixtures rather than a
 * durable store. Fails closed in production per ADR 0007: no fixture-backed
 * surface may render as if it were real operational state once deployed.
 */
export function FixtureGatedPage({
  area,
  env,
  logger,
  children,
}: Readonly<{
  area: string;
  env?: Partial<NodeJS.ProcessEnv>;
  logger?: LoopworksLogger;
  children: ReactNode;
}>) {
  if (isProductionRuntime(env)) {
    const log = logger ?? createRequestLogger({ route: "portal.fixture_gate" });
    log.warn({ area }, "portal_fixture_gate_blocked");
    return <FixtureUnavailableNotice area={area} />;
  }

  return <>{children}</>;
}
