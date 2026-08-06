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
| 6 | `loopworks-empty` org | **not done** — only needed for step 10 |
| 7 | PR #149 merged | done |
| 8 | #152 (`paginate`) fixed and deployed | see below |

`/settings/repositories` shipped with #149, but #152 made every read fail:
the installation client had no `paginate`, so steps 3-10 returned
"Repository list unavailable" and `GET /api/github/repositories` returned 502.
Steps 3-10 need the #152 fix deployed to production.

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
| 3 | Click "Select repositories" | the 6 granted repos list; `factory-core`/`spike-notes` show Private, `legacy-runner` shows Archived, `delivery-ops` shows `trunk`, `ops-scripts` shows `develop`; the 2 ungranted repos are absent |
| 4 | Type `ops` in search | list narrows to `ops-scripts`; Save stays disabled until a checkbox actually changes |
| 5 | Select 2 repos → Save | "2 repositories selected, 0 removed"; Save returns to disabled and the boxes stay checked |
| 6 | Visit `/catalog` | both repos present; "No repositories tracked" gone |
| 7 | Back to selection, deselect 1 → Save | "0 repositories selected, 1 removed"; gone from `/catalog` |
| 8 | Deselect the last one → Save | the catalog empty state returns |
| 9 | On GitHub, remove access to a *selected* repo, then reload the surface | that row shows "Access revoked", no Private/Archived badge, and is still deselectable |
| 10 | Install on `loopworks-empty` with "All repositories", against an empty database | "No repositories reachable" with the "Adjust repository access on GitHub" link — different copy from step 1 |

Step 5 is the one that proves the fix for the frozen-state bug the reviewers
found: before it, Save stayed enabled and the same change could be replayed.

### The in-use refusal

Deselection refuses when a repository still has loops, runs, or a Vercel project
link. #126 has not built loop registration yet, so force it by writing a probe
row directly to the production database — delete it as soon as the step passes:

```sql
INSERT INTO loops (repository_id, github_issue_number, title)
SELECT id, 1, 'manual in-use probe' FROM repositories LIMIT 1;
```

Deselect that repo → expect it kept, the message "still has loop or run
history", and the row still in `/catalog`. Then delete the probe row.

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
  pagination limits.
