import { isProductionRuntime } from "@/lib/runtime";

type PublicOriginEnvironment = Record<string, string | undefined>;

export function parseLoopworksPublicOrigin(
  configured: string,
  env: PublicOriginEnvironment = process.env,
): URL {
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("LOOPWORKS_PUBLIC_URL must be an absolute Loopworks origin.");
  }

  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !["http:", "https:"].includes(origin.protocol)
  ) {
    throw new Error("LOOPWORKS_PUBLIC_URL must be an origin without credentials or a path.");
  }
  if (isProductionRuntime(env) && origin.protocol !== "https:") {
    throw new Error("Production Loopworks URLs require an HTTPS public origin.");
  }

  return origin;
}
