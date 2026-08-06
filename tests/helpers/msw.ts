import { setupServer } from "msw/node";

/**
 * One interception server for the whole Vitest run, registered in `tests/setup.ts`.
 *
 * It ships with no default handlers. Every request a test makes must be stubbed by that test via
 * `server.use(...)`, and `onUnhandledRequest: "error"` turns anything else into a failure rather
 * than a real network call.
 *
 * This exists so tests can exercise the *default* third-party client factories instead of injected
 * fakes. #152 shipped a production-breaking bug precisely because the injected fakes were the only
 * thing under test: the real installation client had no `paginate`.
 */
export const mswServer = setupServer();
