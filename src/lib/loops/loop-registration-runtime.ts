import { db } from "@/db/client";

import { createLoopRegistrationFlow } from "./loop-registration-flow";
import { createLoopDefinitionStore } from "./loop-registration-store";

export function createLoopRegistrationRuntime() {
  return createLoopRegistrationFlow({
    now: () => new Date(),
    store: createLoopDefinitionStore(db),
  });
}
