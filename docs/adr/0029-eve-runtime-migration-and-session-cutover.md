# ADR 0029: Eve Runtime Migration And Session Cutover

Status: Proposed
Date: 2026-08-11
Issue: [#181](https://github.com/ncolesummers/loopworks/issues/181)
Updated by: [#296](https://github.com/ncolesummers/loopworks/issues/296),
[#309](https://github.com/ncolesummers/loopworks/issues/309)

## Context

Loopworks entered this work on `eve@0.22.5`. Eve is still a preview framework,
and its supported release moved through several minor lines while issue #181
waited. Treating the version named when the issue was drafted as authoritative
would preserve stale APIs and peer requirements.

The npm registry's `latest` tag resolved to `eve@0.33.2` when implementation
began on 2026-08-11. Issue #309 advances the issue #296 baseline to `eve@0.51.0`
and the exact AI SDK version proposed with the same Dependabot batch,
`ai@7.0.92`. Eve 0.51 still requires Node.js 24 or newer and declares
`ai@^7.0.82`, OpenTelemetry API 1.x, and Just Bash 3.x peers. The selected pair
satisfies those constraints without changing Loopworks' Node floor. Exact pins
keep a fast-moving preview runtime from changing without a reviewed lockfile
update.

The session protocol also changed between the old and selected lines. Eve
0.31.0 removed continuation-token client routing in favor of fixed,
ID-addressed session handles. The 0.31.1 compatibility change explicitly
preserves deployment upgrades only for sessions persisted by 0.30.3–0.30.8.
That bridge does not include Loopworks' 0.22.5 sessions.

The issue also asks that the user-level Vercel plugin not be downgraded. The
active cache and the marketplace-pinned Vercel plugin both resolve to 0.45.1,
so this migration makes no user-level plugin change. The Codex session plugin
observed during implementation is a separately managed OpenAI plugin at 0.21.4;
it is not the user-level Claude Code plugin named by the issue and is not
modified by this repository change.

Eve 0.33 also changes overlapping channel messages to cancellation-backed
`turnPolicy: "steer"` by default. A replacement is durably buffered before the
active turn is cancelled, but partial output and completed side effects are not
rolled back. Loopworks does not currently author a channel or call the Eve
client from application source, so no live message path silently changes in
this migration.

Eve 0.44's provider pipeline is public-only by default.
Built-in messaging channels now classify conversations as `public`, `private`,
or `unknown`, and the provider `otel()` pipeline applies that audience as a head
gate. Loopworks remains on Eve's legacy single-file instrumentation layout with
`experimental.instrumentationProviders` disabled, so it does not apply that
provider head gate. The current file registers no external exporter and retains
the repository's existing explicit opt-in for raw model inputs and outputs.
Zero-configuration local tracing may still retain unclassified HTTP and TUI
sessions when no authored instrumentation file replaces it.

The intermediate task and HITL contracts also changed. Eve 0.43 lets
experimental in-process background tools report progress and terminal results
through `task.send`, while warning that the callback is not restart-safe for
authored cross-process executors. Eve 0.42 removed the `task_sleep` framework
tool; task-mode parents now wake from lifecycle notifications. HITL
`respond()` calls accept exact response literals or values validated with
`parseInputResponses()`. Eve 0.51 removes the experimental task gate and runs every declared subagent
as a background task. A delegation returns a working receipt, followed by a
terminal notification containing the result. The orchestrator must wait for
that result before applying an artifact; no synchronous compatibility setting
is documented. Admitted children survive initiating-turn cancellation and must
be stopped with `task_cancel`; parent-session finalization cancels them. Existing approval and
question flows continue to park durably at `session.waiting`.

Persistent local and remote subagent continuations now forward the active
caller so user-scoped connections resolve for the current turn rather than
reusing prior authority. A receiver that cannot verify continuation forwarding
rejects the request instead of falling back to service authority. Loopworks
does not enable persistent subagent sessions, but any future rollout must
upgrade both deployments before resuming an existing remote session.

The existing Vercel project previously built only the Next.js portal even
though the repository also contained the Eve agent. Eve 0.33's `withEve()`
integration can emit the portal and agent as sibling Build Output services in
the same Vercel preview, routing `/eve/v1/**` to Eve before Next.js filesystem
routing. A separate staging project would add hostname, configuration, and
promotion drift. It would provide stronger project-identity, environment, and
blast-radius isolation, but that separation is not needed for this repository's
intended same-origin portal-and-agent topology.

## Decision

1. Pin `eve@0.51.0` and its selected AI SDK peer `ai@7.0.92` exactly in
   `package.json` and `bun.lock`, and declare Eve's `engines.node` floor as
   Node.js `>=24` in the application manifest.
2. Keep authored agents on Eve's documented filesystem contracts and verify
   discovery, tools, sandboxes, instrumentation, and evals against the bundled
   0.51.0 documentation and CLI.
3. Use fixed `sessionId` handles for new Eve client or channel work. Ordinary
   messages use positional `send(message, options)`; human-input responses use
   `respond(inputResponses, options)`.
4. A session persisted by 0.22.5 must be replaced after cutover. Before
   promotion, stop admitting old work and drain in-flight sessions on the old
   deployment. Record and cancel anything that cannot drain, deploy the new
   runtime, and start a new session rather than attempting an unsupported
   cross-version resume.
5. Do not update or downgrade the user-level Vercel plugin while its active and
   marketplace versions are both 0.45.1.
6. For future authored Loopworks channels and durable stage messages, select
   `turnPolicy: "queue"` unless cancellation-backed replacement is an explicit,
   tested product behavior. Use `turnPolicy: "steer"` only when retaining
   partial output and already-completed side effects is acceptable. Approval
   responses remain separate and never steer.
7. Wrap the existing Next.js configuration with `withEve(nextConfig)`. Keep the
   portal as the default service and mount the unnamed root agent at
   `/eve/v1/*` in every Vercel preview and production build.
8. Build both processes for local production with `bunx eve build && next
   build`. On Vercel, run `next build` for the host; `withEve()` declares the
   sibling service and Vercel runs its generated Eve build command separately.
9. Exclude `/eve/*` from the portal's Auth.js proxy. Eve owns authentication on
   that route family: health is public, while session and inspection routes use
   Eve's fail-closed route policy.
10. Keep the legacy single-file instrumentation layout for this runtime-only
    migration and do not claim the provider pipeline's public-only head gate is
    active. Keep raw input/output capture behind the existing explicit telemetry
    policy. Before enabling a broader export, either migrate to the provider
    layout under a separate issue with its experimental flag and audience tests,
    or install an equivalent explicit destination filter and verify it.
11. Adopt the required background lifecycle for declared subagents. Keep one
    stage pending at a time, never apply a working receipt or intermediate
    update, and retain the stage on failure or cancellation. Explicitly cancel
    admitted tasks with `task_cancel`. Keep authored tools foreground and do
    not add cross-process background executors in this migration.
12. Remove obsolete `glob` and `grep` disable files because these tools are
    opt-in in 0.51; a disable sentinel without a lower-precedence source prevents
    startup. Keep dangerous defaults disabled, including root copy delegation,
    and assert the actual compiled root and sibling tool surfaces.

## Consequences

The runtime and its mandatory AI SDK peer move together under an inspectable
lockfile. Exact pins trade automatic preview updates for explicit dependency
review, which is appropriate while Eve's public APIs are changing rapidly.

Old sessions lose transparent continuity across this cutover. Draining first
preserves work that can finish safely, while replacement avoids replaying a
0.22.5 continuation envelope through a runtime that no longer accepts that
contract. The operator must retain the old session identifier and terminal
reason as migration evidence rather than presenting a replacement session as a
resume.

The queue default for future Loopworks-authored stage delivery favors finishing
accepted durable work over low-latency replacement. A feature that deliberately
adopts steering must test cancellation boundaries, recursive subagent
cancellation, approval state, and idempotency of any side effects.

Portal and agent staging now share one deployment identity and commit. The Eve
route remains fail-closed under its default Vercel OIDC, local-development, and
placeholder authentication chain; mounting the service does not make session
routes anonymous. That default does not authenticate an ordinary Loopworks
Auth.js browser session. Issue #181 validates operator/server access through
Vercel OIDC; any future portal chat surface must add and test an Auth.js-backed
Eve `AuthFn` before sending browser requests.

`GET /eve/v1/health` is intentionally public and bypasses the portal proxy.
Because the previous Vercel deployment exposed no Eve service, it has no
remotely persisted 0.22.5 sessions to drain. Any local 0.22.5 development
session is unsupported migration input and must be replaced rather than
presented as resumed.

## Validation

1. The red-first dependency/runtime contract asserts the exact package and
   lockfile versions and installed fixed-session API, then compiles the real
   agent and checks its discovery and guarded tool surface.
2. `bun test tests/unit/agent` covers agent discovery, guarded tools, sandbox
   definitions, instrumentation, and eval contracts on the selected runtime.
3. `bunx eve info --json` reports the root and declared siblings without
   discovery diagnostics, and `bunx eve eval --list` finds every authored eval.
4. Staging evidence must identify the deployment and selected Eve version, then
   cover a new session, a subagent handoff, cancellation and approval handling,
   and the old-session disposition. It must also show the public health route,
   protected session route, and unchanged portal route. Fixture-only evidence
   does not satisfy this item. The pull request remains draft until this passes.
   For [#311](https://github.com/ncolesummers/loopworks/issues/311), the approved
   runtime-only scope uses an isolated hosted diagnostic agent with the candidate
   dependency graph and security patches. Real model calls, durable child tasks,
   parent-forwarded tool approval, denial, and explicit task cancellation count
   as runtime evidence; mocked events only test the evidence checker. Pair this
   with the exact-head Loopworks preview health, auth, session and cancellation
   smoke. This does not establish Loopworks run authorization, automatic dispatch,
   or portal approval/resume integration. Those remain separate product work.
   Follow the [runtime probe runbook](../runbooks/eve-runtime-probe.md).
5. `bun run validate` and `bun run build` pass before merge.

## Follow-Ups

1. Link the staging evidence from issue #181 and the implementing pull request.
2. Accept this ADR only after maintainer review of the migration and real
   staging evidence.
