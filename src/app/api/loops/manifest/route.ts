import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createRequestLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";

export async function GET() {
  const requestLogger = createRequestLogger({
    route: "api.loops.manifest",
    repositoryFullName: defaultLoopManifest.repo,
  });
  const apiSession = await requireApiSession({
    route: "api.loops.manifest",
    logger: requestLogger,
  });
  if (!apiSession.authenticated) {
    return apiSession.response;
  }

  requestLogger.info(
    {
      actorId: apiSession.actorId,
      authMode: apiSession.mode,
    },
    "loop_manifest_returned",
  );

  return NextResponse.json(defaultLoopManifest);
}
