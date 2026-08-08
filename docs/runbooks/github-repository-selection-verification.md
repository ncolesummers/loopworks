# Live verification runbook — repository selection (#125)

Target: **production**, <https://loopworks.vercel.app>.

Preview deployments sit behind Vercel SSO and 302 to `vercel.com/sso-api`, so
GitHub's post-install redirect would land on a login wall. Production is public,
which makes it the only workable target without disabling deployment protection.

## Status

| # | Setup step | State |
| --- | --- | --- |
| 1 | `loopworks-sandbox` org | done |
| 2 | Eight fixture repos | done |
| 3 | GitHub App `loopworks-dev` (App ID 4491786) | done, settings confirmed |
| 4 | Ten production env vars | done |
| 5 | Production redeployed and booting | done |
| 6 | `loopworks-sandbox-empty` org | done — empty by design, only needed for step 10 |
| 7 | PR #149 merged | done |
| 8 | #152 (`paginate`) fixed and deployed | done |

`/settings/repositories` shipped with #149, but #152 made every read fail: the
installation client had no `paginate`, so steps 3-10 returned "Repository list
unavailable" and `GET /api/github/repositories` returned 502. Fixed in #154 and
deployed to production.

### Last verified

2026-08-06, against installation `151596823` on `loopworks-sandbox`. Steps 3-5
and 7-9 passed. Step 6 failed on a separate defect (#155), fixed since; step 6
has not been re-run against production. Step 10 has never been run — see
"Step 10 costs a reset" below.

Merging to `main` deploys production automatically through the Vercel Git
integration; no manual deploy step is needed for a code change.

## What was already set up

### The org and its repos

`loopworks-sandbox`, created by `create-sandbox-repos.sh`:

| Repo | Visibility | Default branch | Why it exists |
| --- | --- | --- | --- |
| `portal-web` | public | `main` | baseline |
| `factory-core` | private | `main` | "Private" badge |
| `delivery-ops` | private | `trunk` | non-`main` branch slot |
| `integration-playground` | public | `main` | search target |
| `docs-site` | public | `main` | search target |
| `spike-notes` | private | `main` | search target |
| `ops-scripts` | public | `develop` | second non-`main` branch |
| `legacy-runner` | public, archived | `main` | "Archived" badge |

### The GitHub App

<https://github.com/organizations/loopworks-sandbox/settings/apps/loopworks-dev>

| Field | Value |
| --- | --- |
| App ID | `4491786` |
| Slug | `loopworks-dev` |
| Client ID | `Iv23li0bCOE3SZj5tMNi` |
| Callback URL | `https://loopworks.vercel.app/api/github/install/callback` |
| Callback URL (2nd) | `https://loopworks.vercel.app/api/auth/callback/github` |
| Setup URL | `https://loopworks.vercel.app/api/github/install/callback` |
| Request user authorization (OAuth) during installation | **off** |
| Redirect on update | **off** |

Three settings that break the flow in confusing ways if changed:

- **OAuth-during-installation must stay OFF.** The flow runs its own
  authorization step after the install returns. If GitHub sends a `code` on the
  installation redirect, the callback takes the authorization branch while
  holding an installation-phase challenge, and the connection fails as a bare
  `error`.
- **Setup URL and the first Callback URL must be the same route.** ADR 0021
  relies on one route serving both phases.
- **Redirect on update must stay OFF.** It sends the operator to the Setup URL
  after every repository-access change, carrying `setup_action=update` and no
  challenge state. The callback finds nothing to consume and returns `error`, so
  every access change would dead-end on `/settings?github=error`. Step 9 reloads
  the surface instead, which is what actually exercises the live read.

Required permission: **Repository → Metadata: Read**. Without it the repository
list comes back empty and looks exactly like the zero-access state.

### Production environment

Ten variables were missing, which is why every route — including `/` and
`/favicon.png` — returned 500: the config registry throws in the instrumentation
hook, before middleware. Now set: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
`LOOPWORKS_PUBLIC_URL`, `LOOPWORKS_EVE_TEST_RECEIPT_SECRET`, `GITHUB_APP_ID`,
`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`.

`AUTH_SECRET`, `DATABASE_URL`, and the allowlists were already set.
`vercel-build` runs `db:migrate && build`, so production migrations apply on
every deploy — the schema is current.

To change a value later:

```bash
cp scripts/prod-env.example prod-env.local    # fill in; gitignored, holds live secrets
./scripts/set-production-env.sh prod-env.local
vercel redeploy <production-deployment-id>    # not `deploy --prod`, see below
```

Use `redeploy`, not `vercel deploy --prod`: the latter uploads your current
working tree, which would push whatever branch you have checked out to
production.

## What to verify

Sign in at <https://loopworks.vercel.app>, then go to `/settings`.

| # | Step | Expected |
| --- | --- | --- |
| 1 | `/settings` before installing | "Not connected" badge and a Connect GitHub App button |
| 2 | Connect the App → `loopworks-sandbox`, "Only select repositories", pick 6 of 8 | returns to `/settings` with "connected successfully"; account `loopworks-sandbox`, type Organization, and the installation id render |
| 3 | Click "Select repositories" | the 6 granted repos list; `delivery-ops`/`factory-core` show Private, `legacy-runner` shows Archived, `delivery-ops` shows `trunk`, `ops-scripts` shows `develop`; `docs-site` and `spike-notes` are absent |
| 4 | Type `scripts` in search | list narrows to `ops-scripts`; Save stays disabled until a checkbox actually changes |
| 5 | Select 2 repos → Save | "2 repositories selected, 0 repositories removed."; Save returns to disabled and the boxes stay checked |
| 6 | Visit `/catalog` | exactly the 2 repos selected in step 5 are listed, with no loops, deployments, or approvals present; the header chip reads "Live database", not "Unavailable" |
| 7 | Back to selection, deselect 1 → Save | "0 repositories selected, 1 repository removed." |
| 8 | Deselect the last one → Save | the counter returns to "0 repositories selected" |
| 9 | On GitHub, remove access to a *selected* repo, then reload the surface | that row shows "Access revoked", no Private/Archived badge, and is still deselectable |
| 10 | Install on `loopworks-sandbox-empty` with "All repositories", against an empty database | "No repositories reachable" with the "Adjust repository access on GitHub" link — different copy from step 1 |

Which repos are granted is what step 3 actually asserts, so re-read it from the
installation rather than trusting this table if the grant set has been changed.
As of the last verification the 6 granted are `delivery-ops`, `factory-core`,
`integration-playground`, `legacy-runner`, `ops-scripts`, and `portal-web`.

Search is a substring match over the full name, so `ops` matches both
`delivery-ops` and `ops-scripts` — it does not isolate one row. Use `scripts`.

Step 5 is the one that proves the fix for the frozen-state bug the reviewers
found: before it, Save stayed enabled and the same change could be replayed.

Step 6 is the only step that asserts catalog contents; steps 7 and 8 assert the
selection counter. Step 6 was previously unexecutable: `/catalog` rendered "No
repositories tracked" no matter what was selected, because in production the
portal discarded every record unless repositories, loops, deployments, an
approval, and settings were *all* non-empty, and loop registration is #126. #155
replaced that global gate with per-surface requirements, so the catalog should
now reflect the selection with loops and deployments still empty. **That
expectation has not yet been confirmed against production** — it is covered by
`tests/unit/portal/pages-production-gate.test.tsx`, not by a live run.

If `/catalog` shows "No repositories tracked" while the counter in step 5
reported a selection, re-check `GET /api/github/repositories` — if it returns the
rows as `"selected": true`, the read path has regressed, not the write path.

### Step 10 costs a reset

Step 10 cannot be appended to a normal run. It needs
`loopworks-sandbox-empty` to be the **only** connected installation, and that
takes more than uninstalling the other one:

- The surface manages one installation, chosen as the lowest installation id —
  `const [installation] = await store.listInstallations()`
  (`src/lib/github/repository-selection.ts:86`) over
  `.orderBy(asc(githubInstallations.installationId))`
  (`repository-selection-store.ts:60`). GitHub ids increase, so a newer
  installation never wins while `loopworks-sandbox` (151596823) is connected.
  That is #146.
- Uninstalling `loopworks-sandbox` is still not enough: its row survives in
  `github_installations` (#147), so it keeps winning the ordering and the
  surface fails trying to read repositories the App can no longer reach. That is
  an *error* state, not the empty state step 10 asserts.

So the full sequence is: truncate, install on `loopworks-sandbox-empty` with
"All repositories", verify, then reinstall on `loopworks-sandbox` and redo
step 2. Budget a whole cycle for it, and expect several GitHub sudo prompts.

The org itself exists and is intentionally empty — do not add repositories to
it. `loopworks-empty` is a different, unrelated account owned by someone else.

### Step 9 in practice

`gh api -X DELETE /user/installations/<id>/repositories/<repo_id>` returns 403
with a personal access token — the endpoint needs a user-to-server token from
the App. Do it through the web UI instead:

<https://github.com/organizations/loopworks-sandbox/settings/installations/151596823>

GitHub gates that page behind a sudo prompt ("Confirm access"), which needs an
interactive password or passkey. An agent cannot clear it; a human has to.

Restore access afterwards from the same page — "Select repositories" → pick the
repo → Save — or the next run of step 3 will be one repo short.

### The in-use refusal

Deselection refuses when a repository still has loops, runs, or a Vercel project
link. #126 has not built loop registration yet, so force it by writing a probe
row directly to the production database — delete it as soon as the step passes:

```sql
INSERT INTO loops (repository_id, github_issue_number, title)
SELECT id, 1, 'manual in-use probe' FROM repositories LIMIT 1;
```

Deselect that repo → expect it kept and the message "still has loop or run
history". Then delete the probe row.

This probe's purpose is the deselect refusal, not catalog contents — step 6
covers those, and the probe adds a *loop* to a repository the catalog already
lists. This probe has not been run since #152 was fixed.

## Resetting between runs

**This destroys data in the production database.** It is safe only while
production holds nothing but verification data. Once anything real lands there,
stop using this section.

Pull the connection string into a file rather than interpolating it into a
command — a URL on the command line is visible to every local process through
`ps` and lands in shell history:

```bash
vercel env pull --environment=production .env.production.local
```

Confirm you are pointed where you think you are before writing anything:

```bash
psql "$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"')" \
  -c 'SELECT current_database(), count(*) FROM repositories;'
```

An empty `DATABASE_URL` makes `psql` fall back to local defaults, so a silent
CLI-format change would otherwise point the next statement at whatever database
your environment happens to name. If that query does not show the production
database, stop.

Then, deliberately:

```sql
TRUNCATE repositories, github_installations, github_installation_flows
  RESTART IDENTITY CASCADE;
```

`CASCADE` on `repositories` also removes loops, runs, artifacts, and approvals
for those repositories. Delete `.env.production.local` when you are done.

To redo step 1, uninstall the App from the org:
<https://github.com/organizations/loopworks-sandbox/settings/installations>

## Known gaps this cannot exercise

- **Multi-installation (#146).** With both orgs connected, selection manages only
  the lower-numbered installation. Connect `loopworks-sandbox` first and check
  which account the surface names before trusting step 3.
- **Operator-bound authorization (#145).** Any allowlisted operator can manage
  the installation; there is no per-operator access check to observe.
- **Large installations (#148).** Eight repos will not surface the batching or
  pagination limits. Nor will they surface rate-limit behavior: the installation
  client carries no retry or throttling plugin, so a secondary rate limit
  mid-pagination fails the whole read with no retry and no coded reason.
- **Real pagination.** Six repositories fit in one page at `per_page=100`, so no
  step here crosses a page boundary. That path is covered offline instead, by
  the MSW cases in `tests/unit/github/installation-gateway.test.ts` (ADR 0022).
- **Loop and deployment surfaces.** Step 6 asserts the catalog, but `/loops`
  and `/approvals` stay legitimately empty until loop registration (#126) lands,
  so this runbook cannot assert populated content on either.
- **Multi-installation catalog scope.** `readPortalRecords` reads every
  `repositories` row without filtering by installation or GitHub App, so step
  6's "exactly the 2 repos selected" holds only while production has a single
  installation.
