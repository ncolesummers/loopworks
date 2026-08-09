"use client";

import { useRouter } from "next/navigation";

import { LoopRegistrationView } from "@/components/portal/loop-registration-view";
import type { LoopRegistrationSnapshot } from "@/lib/loops/loop-registration-flow";

/**
 * The registration surface is rendered from a server read, so a registration leaves the Router
 * Cache holding the pre-registration registry. This refreshes the server components afterwards.
 */
export function LoopRegistrationRefresher({
  fixtureMode = false,
  snapshot,
}: Readonly<{ fixtureMode?: boolean; snapshot: LoopRegistrationSnapshot }>) {
  const router = useRouter();

  return (
    <LoopRegistrationView
      fixtureMode={fixtureMode}
      onRegistered={() => router.refresh()}
      snapshot={snapshot}
    />
  );
}
