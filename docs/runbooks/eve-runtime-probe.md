# Hosted Eve Runtime Probe

Target: an **isolated Vercel diagnostic project** named
`loopworks-runtime-probe`, never the Loopworks Preview or Production project.
Tracks [#311](https://github.com/ncolesummers/loopworks/issues/311) and
[ADR 0029](../adr/0029-eve-runtime-migration-and-session-cutover.md).

## Evidence boundary

This probe runs the selected Eve and AI releases with real model calls, Vercel
Workflow persistence, a declared background worker, and a harmless
`approved_marker` tool that returns its input only after explicit approval.
It never imports Loopworks tools or receives database, GitHub, or provider keys.
Vercel OIDC authenticates both operator requests and AI Gateway access.
Shell, file, network and generic delegation tools are disabled in both agents.

The repository's unit tests exercise rejected evidence and compile the actual
agent surface. They do not substitute for the hosted run. A passing hosted run
must demonstrate:

- One declared worker and a working receipt tied to that child and parent.
- The child's real tool-approval request forwarded to the parent; the child is
  parked and the receipt tool has not executed before a response.
- Approval through the parent resolves the exact request, executes the tool
  once, returns the unique marker, and completes the child task.
- Denial resolves the exact request without successful tool execution.
- Explicit `task_cancel` cancels an admitted child that is waiting for approval,
  without successful tool execution. Turn cancellation alone is insufficient.

The probe also calls `task_cancel` after completed approval/denial tasks. Eve
specifies that cancelling a finished task changes nothing; its returned terminal
view independently confirms completion rather than accepting a working receipt.
The runner uses finite snapshots and bounded waits. It retires only sessions it
created and fails if cleanup cannot be confirmed. A failed creation request can
leave server-side acceptance uncertain; the runner reports that uncertainty
instead of claiming cleanup. Inspect the diagnostic project before retrying.
Logs contain IDs and verdicts,
never credentials or raw model messages.

This proves runtime lifecycle behavior. It does not prove Loopworks run binding,
automatic dispatch, or the portal's plan-review approval/resume path.

## Stage and deploy

Use a clean, reviewed candidate checkout. Choose a new absolute temporary
staging path; the staging command refuses to overwrite an existing directory.
It copies the candidate dependency declarations, byte-identical Bun lockfile,
security patches, and only the diagnostic agent. It replaces application build
scripts with `eve build`, so no migration command is present. No environment,
project link, application source or product agent files are copied.

```sh
bun run scripts/eve-runtime-probe.ts stage /private/tmp/loopworks-probe-candidate
cd /private/tmp/loopworks-probe-candidate
bun install --frozen-lockfile
node node_modules/eve/bin/eve.js info --json
vercel link --project loopworks-runtime-probe --scope ncolesummers-projects --yes
vercel deploy --target=preview --scope ncolesummers-projects --yes
```

Create the isolated project explicitly if it does not exist. Verify its project
ID differs from Loopworks before deploying. Vercel may make a new project's
first deployment Production despite the requested target. Verify the actual
target; create a subsequent Preview and remove the bootstrap deployment after
validation. Never promote the probe into the Loopworks project.
Never copy `.env` files from
Loopworks into this project. Keep Vercel deployment protection enabled and use
an exact deployment URL, not a mutable alias. Retain `probe-identity.json`, the
candidate commit, deployment ID, frozen-install result and compiled tool list.
Add the candidate SHA and lock digest as Vercel deployment metadata when running
the actual deployment, then verify those fields through the deployment API.

## Run and clean up

**Credential-handling step:** obtain a fresh Preview OIDC token using
`vercel env pull` in the linked isolated staging directory. Store it in a
private temporary file with mode 600; never print or commit its contents.
Then run the checker from the candidate checkout, passing the credential file explicitly (only its OIDC token is read):

```sh
bun run scripts/eve-runtime-probe.ts verify \
  https://loopworks-runtime-probe-DEPLOYMENT-ncolesummers-projects.vercel.app \
  /private/tmp/loopworks-probe-preview.env
```

The caller authorizes the runner to approve only the harmless diagnostic
receipt. Denial and cancellation use separate owned sessions and markers.
Keep the original project's exclusive `preview:alias` lease while pairing this
probe with its exact-head application preview checks. Record both deployment
identities in the PR evidence.

Check the Eve info route without an `Authorization` header and require 401.
Supply the isolated OIDC token only in `x-vercel-trusted-oidc-idp-token` to
pass Vercel Deployment Protection separately; never print the header. Remove temporary credential files after the run, even
on failure. Inspect any reported cleanup failure before retrying; never cancel
sessions not created by this invocation. Remove the bootstrap deployment and
its aliases after obtaining the final Preview evidence. The diagnostic agent
has no scheduled work and requires OIDC for session access.
