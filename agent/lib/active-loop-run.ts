import { z } from "zod";

const loopRunIdClaim = "loopworks.run_id";
const loopRunIdSchema = z.string().uuid();

type SessionAuth = {
  current?: unknown;
  initiator?: {
    attributes: Readonly<Record<string, string | readonly string[]>>;
  } | null;
};

export function readActiveLoopRunId(auth: SessionAuth): string | undefined {
  const claim = auth.initiator?.attributes[loopRunIdClaim];
  if (typeof claim !== "string") return undefined;
  const parsed = loopRunIdSchema.safeParse(claim);
  return parsed.success ? parsed.data : undefined;
}
