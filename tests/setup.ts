import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

import { mswServer } from "./helpers/msw";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

/**
 * Requests no test stubbed. MSW's own `onUnhandledRequest: "error"` only rejects the *request*,
 * which code under test can catch — both GitHub route handlers map a thrown fetch to a 502, so an
 * escaped request would otherwise flip an assertion instead of failing the run. Recording them and
 * asserting after each test makes the escape itself fatal, however the caller handles it.
 */
const unhandledRequests: string[] = [];

beforeAll(() =>
  mswServer.listen({
    onUnhandledRequest: (request, print) => {
      unhandledRequests.push(`${request.method} ${request.url}`);
      // Still block the request; without this MSW passes it through to the real network.
      print.error();
    },
  }),
);

afterEach(() => {
  mswServer.resetHandlers();
  const escaped = unhandledRequests.splice(0);
  if (escaped.length > 0) {
    throw new Error(`Test made ${escaped.length} unstubbed request(s):\n  ${escaped.join("\n  ")}`);
  }
});

afterAll(() => mswServer.close());
