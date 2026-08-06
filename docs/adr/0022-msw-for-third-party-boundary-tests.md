# ADR 0022: MSW for Third-Party Boundary Tests

Status: Proposed
Date: 2026-08-05
Issue: [#152](https://github.com/ncolesummers/loopworks/issues/152)

## Context

Loopworks wraps third-party SDKs behind injectable factories — the GitHub
installation gateway's `createAppClient`, `createInstallationClient`, and
`createUserClient` are the pattern. Tests supply fakes through those seams,
which keeps them fast and offline.

The seams hid a production outage. `createInstallationClient` defaulted to
`App.getInstallationOctokit()`, an `@octokit/core` instance with no `.paginate`,
while `listInstallationRepositories` called `.paginate`. Every test injected a
fake whose `paginate` existed, so the default factory — the only construction
that runs in production — was never executed. Unit, integration, e2e,
`bun run validate`, and `bun run build` were all green on the merged PR, and
repository selection was still entirely non-functional in production (#152).

A seam that hides its own default is untested by construction. Fakes also encode
our belief about the vendor's behavior rather than the vendor's behavior: the
fakes returned a flat array, while the live endpoint returns
`{total_count, repository_selection, repositories}` across `Link`-paginated
pages, and only the real client unwraps and follows it. No fake can fail in the
way the vendor does.

Testing the default factory needs the SDK driven over HTTP without a network.
The alternative considered was threading the gateway's existing `fetchImpl`
into client construction. That works, but it grows the production signature with
a test-shaped seam and so tests a path slightly different from the shipped one —
the same class of mistake that caused #152.

## Decision

Use MSW (`msw/node`) to intercept HTTP at the network boundary, so tests can
exercise the real, unmodified client construction path.

One `setupServer()` is registered repo-wide in `tests/setup.ts`, defined in
`tests/helpers/msw.ts`. It ships **no default handlers**. Tests register their
own with `server.use(...)`, and handlers reset after each test.

Unhandled requests are both blocked and recorded, and `afterEach` throws if any
were recorded. MSW's `onUnhandledRequest: "error"` alone is not sufficient: it
rejects the *request*, which code under test can catch. Both GitHub route
handlers map a thrown fetch to a 502, and `exchangeUserCode` wraps its fetch in
`try`/`catch`, so an escaped request would flip an assertion rather than fail
the run — the same silent-pass shape as #152. The `afterEach` assertion is what
makes the escape fatal.

Reach for MSW when the thing under test is a third-party client's real behavior
— pagination, response envelopes, auth headers, retries, error mapping. Keep
injected fakes for our own logic above that boundary; they remain the right tool
for normalization, policy, and control flow, and MSW does not replace them.

Do not add default handlers to the shared server. A default handler is a silent
production fallback in test clothing: it would let a test pass without stating
what it expects the vendor to return, which is the failure mode this ADR exists
to prevent.

## Consequences

Tests can cover the default factories, so an SDK-shape regression fails in CI
instead of in production. Handlers state the vendor contract explicitly and in
one place, and reviewers can see what shape we believe the API returns.

Accidental network access becomes a hard failure across the whole suite, which
removes a class of flaky, machine-dependent tests. Any future test that reaches
out must stub deliberately.

Costs: a devDependency and a global interception layer the repo did not have.
Registration runs in every test file, including the majority that make no
requests — measured at roughly 0.7s of added setup across the 99-file suite.
That is accepted as the price of the guarantee holding everywhere by default
rather than only where someone remembered to opt in.
Tests exercising app-authenticated GitHub calls must generate an RSA keypair
in-process, because `@octokit/auth-app` signs the app JWT locally — MSW does not
remove that requirement. Handlers are less local than an injected fake, so an
over-broad handler can mask a genuine mismatch; keep them scoped to the test
that needs them.

The Playwright lane (`tests/e2e/**`) and the native Postgres lane
(`tests/integration/postgres/**`) are excluded from this Vitest config and are
unaffected.

## Validation

- `tests/setup.ts` registers exactly one server, with no default handlers and
  `onUnhandledRequest: "error"`.
- `tests/unit/github/installation-gateway.test.ts` constructs the gateway with
  no injected `createInstallationClient` and asserts repositories are returned
  across two `Link`-paginated pages of the counted envelope.
- Reintroducing `App.getInstallationOctokit()` as the default fails
  `bun run typecheck` with `Property 'paginate' does not exist on type 'Octokit'`.
- The full suite passes with the interception layer active.

## Follow-Ups

- [#153](https://github.com/ncolesummers/loopworks/issues/153) — audit unsafe
  type assertions at integration boundaries; the cast that hid #152 from the
  compiler is the same failure from the type side.
- [#119](https://github.com/ncolesummers/loopworks/issues/119) — the coverage
  audit should treat "injectable seam whose default factory is never exercised"
  as a named gap pattern, not just an uncovered line.
- [#148](https://github.com/ncolesummers/loopworks/issues/148) — `@octokit/rest`
  is constructed without the retry and throttling plugins, so a secondary rate
  limit mid-pagination fails the whole read with no retry and no coded reason.
  Large-installation behavior is that issue's scope, not #152's.
- `docs/runbooks/github-repository-selection-verification.md` covers the live
  side of this surface; the offline MSW cases and that runbook verify the same
  normalization from opposite directions.
