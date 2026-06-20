import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { createRequestLogger } from "@/lib/observability/logger";
import { createVercelDeploymentClient } from "@/lib/vercel/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const requestLogger = createRequestLogger({
    route: "api.vercel.deployments",
    vercelProjectId: projectId,
  });
  const apiSession = await requireApiSession({
    route: "api.vercel.deployments",
    logger: requestLogger,
  });
  if (!apiSession.authenticated) {
    return apiSession.response;
  }

  const client = createVercelDeploymentClient({
    accessToken: process.env.VERCEL_ACCESS_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    teamSlug: process.env.VERCEL_TEAM_SLUG,
    logger: requestLogger,
  });

  const result = await client.listDeployments({
    projectId,
    limit: Number.isInteger(limit) ? limit : 20,
  });

  requestLogger.info(
    {
      actorId: apiSession.actorId,
      authMode: apiSession.mode,
      source: result.source,
      usedFallback: result.usedFallback,
      fallbackReason: result.fallbackReason,
      deploymentCount: result.deployments.length,
    },
    "vercel_deployments_listed",
  );

  return NextResponse.json(result);
}
