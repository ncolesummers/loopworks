# Development

This guide is the canonical local-development entry point. Configuration names
and defaults live in the generated [`.env.example`](../.env.example); update the
configuration registry rather than maintaining another variable list here.

## Fixture Mode

The quickest path needs no GitHub or database credentials:

```bash
bun install
LOOPWORKS_PORTAL_DATA_MODE=fixtures bun run dev:fixture
```

Open <http://127.0.0.1:3000>. Both fixture data and auth bypass are ignored in
production.

## Local Integrations

Copy `.env.example` to the untracked `.env.local`, replace only the values your
workflow needs, and keep Postgres on a loopback host. Then run migrations before
starting the ordinary server:

```bash
bun run db:migrate
bun run dev
```

`bun run dev` needs nothing further. A local **production** server does:
`next start` sets `NODE_ENV=production` with no `VERCEL_ENV`, so the portal
verifies the store's identity before reading it (#158) and otherwise renders
every surface as unavailable. To run one:

```bash
bun run db:provision --check     # prints the identity, or exits 1 if there is none
```

Set `LOOPWORKS_EXPECTED_STORE_ID` in `.env.local` to the value it reports, using
`bun run db:provision` first if the store has none. Copying the placeholder out
of `.env.example` does not work — it is treated as unconfigured on purpose, so a
pasted example cannot masquerade as a verified store.

`bun run scripts/seed-day-zero.ts reset` truncates every public table, which
takes the identity row with it. `bun run db:migrate` will not restore it —
migration `0003` is already recorded as applied — so re-run `bun run db:provision`
and update the variable after a full reset.

For hosted Preview and Production configuration, use the
[Vercel and Neon runbook](runbooks/vercel-neon-deployment.md).

## Webhook Fixtures

Inspect a signed issue webhook without sending it:

```bash
bun run github:webhook-fixture -- --kind agent-ready
bun run github:webhook-fixture -- --kind spike-agent-ready
```

Sending must use the immutable tuple for an active tracked repository and an
actor whose live repository permission is triage or higher. The local server
also needs GitHub App credentials so it can perform the installation-authenticated
permission read:

```bash
bun run github:webhook-fixture -- --kind agent-ready --send \
  --repository owner/repository --repository-id 123456 \
  --installation-id 789012 --sender-id 345678 --sender-login operator
```

The script refuses non-loopback targets and refuses `--send` when any tuple
field is implicit. Dry runs retain deterministic realistic sample values.

## Local Database Data

After migrations, seed the fixed demo rows with `bun run db:seed`. Use
`bun run db:seed:reset` to replace only those owned rows, or add `-- --dry-run`
to either command to inspect its plan. ADR 0007 requires both commands to reject
production runtimes, remote hosts, and non-Postgres URLs.

The browser and native concurrency lanes use a dedicated local database:

```bash
createdb --host 127.0.0.1 --username loopworks loopworks_e2e
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run test:e2e:seeded
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run test:integration:postgres
```

The seeded lane proves live database behavior. The native lane uses independent
Postgres sessions for lock-scheduling evidence that PGlite cannot provide.
**Both the native lane and the seeded lane's day-zero stage truncate every table
in the `public` schema of `loopworks_e2e` with identity restart and cascading
cleanup.** Run the seeded lane again afterward if you need its demo rows.

`test:e2e:seeded` orchestrates two browser projects in sequence. The `day-zero`
project walks a brand-new operator from an empty database to a registered loop,
so it runs first, on the database migration leaves behind;
`scripts/seed-day-zero.ts` stages it (`reset`, `installation`, `repository`)
under the same guard, and its reset returns the database to empty before the
demo rows land for the `seeded-postgres` project. Stage the walk by hand while
debugging:

```bash
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run scripts/seed-day-zero.ts installation
```

### Recreating the test database

**Destructive: the following commands delete the entire local `loopworks_e2e`
database.** Use them only for the named loopback test database, such as after a
pre-production migration baseline changes:

```bash
dropdb --host 127.0.0.1 --username loopworks loopworks_e2e
createdb --host 127.0.0.1 --username loopworks loopworks_e2e
```

Recreate any remote non-production database through its provider. Never point
these commands at a hosted database.

## Pull Request Shape

Choose the delivery shape before generating implementation code. The purpose is
to give reviewers a sequence of quick, coherent decisions—not to minimize a
line count mechanically.

| Shape | Reach for it when |
| --- | --- |
| Single PR | The change is one coherent idea that can be understood, tested, reviewed, and reverted as a unit. |
| Stack | One story contains two or more dependent, independently reviewable changes. |
| Separate PRs or stacks | Changes are independent or unrelated and do not need one another to be reviewed or merged. |

Default to a single pull request. Use a stack only when each proposed layer has
its own purpose and the upper layer genuinely depends on the lower one. A large
but indivisible mechanical change may still be one PR; several small unrelated
changes do not become a stack merely because one agent found them together.
PR shape does not grant publication authority. For a single PR, use
`implement-issue` or `implement-issue-pr` according to the request. A stack
requires explicit authority to create its worktree and branches, commit, push,
and open PRs. Without that authority, record the proposed layers and follow the
paused `implement-issue` boundary. With it, keep the root guide's issue-backed
TDD, worktree, review, validation, and provenance requirements. Use
`implement-issue-pr` for the issue workflow and acceptance evidence, and add
`gh-stack` only for the stacked branch and publication mechanics.

### Split by meaning

Good layer boundaries reduce the amount of context a reviewer must hold:

- foundation, then consumer—for example schema, service, and UI;
- behavior-preserving refactor, then the behavior change that uses it;
- dependency or generated output, then the substantive code that consumes it;
- low-risk foundation, then an independently reversible risky change; or
- subsystem boundaries that need different reviewers.

Keep each behavior change and its tests in the same layer. A final integration
layer is appropriate only when it verifies the assembled stack. Do not split by
an arbitrary line or file count, put all tests in a later PR, or let a lower
layer import code introduced above it. If a layer needs a long explanation to
make its diff understandable, split it again along a semantic boundary.

Plan the dependency order explicitly, with foundations closest to `main`:

```text
main
└── issue-123-model
    └── issue-123-service
        └── issue-123-ui
```

Use one isolated worktree for the issue or story and create the stack's branches
inside it. Each branch must be coherent and independently satisfy the relevant
tests and repository validation because GitHub evaluates every layer against
the stack's trunk rules.

The root guide's adversarial review is universal, not a single-PR workflow
step. Before submitting a stack, both reviewers inspect every proposed PR diff
in dependency context and the assembled top-of-stack diff.

### Work with a stack

GitHub stacked pull requests are in public preview and require GitHub CLI 2.90.0
or later. Check `gh --version`, then install the extension with `gh extension
install github/gh-stack`. Agents must also use the repository's `gh-stack`
skill, which supplies the non-interactive command contract and error recovery
details. The version here overrides that vendored skill's older generic GitHub
CLI minimum. This project guide also overrides generic split examples in that
skill: do not move behavior tests or routine documentation into later layers
merely because they are different file types.

Create branches from bottom to top. Stage deliberately so work lands in the
layer where it belongs, and keep the repository's signed-commit policy:

```bash
# From the main checkout, after confirming the branch and path are unused:
git fetch origin main
git worktree add -b agent/123-model \
  ../loopworks-worktrees/123-feature origin/main
cd ../loopworks-worktrees/123-feature
bun install

# Enable per-worktree config once, then keep these values out of sibling trees.
git config extensions.worktreeConfig true
git config --worktree rerere.enabled true
git config --worktree remote.pushDefault origin
gh stack init agent/123-model
# Run the model layer's TDD, dual-review loop, validation, and preflight.
bun run commit:preflight
git add path/to/model.test.ts path/to/model.ts
git commit -S -m "feat(model): add the issue model"
git verify-commit HEAD

gh stack add agent/123-service
# Repeat TDD, dual review, validation, and preflight for the service layer.
bun run commit:preflight
git add path/to/service.test.ts path/to/service.ts
git commit -S -m "feat(service): consume the issue model"
git verify-commit HEAD

# Have both reviewers inspect every layer and the assembled top diff. Resolve
# findings, return revised diffs to both, and repeat until the stack is clear.
bun run validate
gh stack submit --auto
gh stack view --json
```

Run `bun run commit:preflight` before committing. Before `submit` pushes any
branch, verify every commit introduced by every layer with `git verify-commit`;
the `HEAD` checks above are the single-commit example, not permission to skip a
longer branch range. After submission, verify each PR with
`bun run commit:provenance --github <PR>` and stop on any author, committer, or
signature mismatch.

`submit --auto` creates draft PRs by default. Agents leave every layer draft,
fill the repository PR template for each layer after submission, and never
merge or mark a PR ready without separate authority. Lower layers use
`Refs #<issue>`; only the top layer uses `Closes #<issue>`, so partial bottom-up
merges cannot close unfinished work. Each PR's evidence table covers that
layer's acceptance criteria, while the top layer also records whole-stack
validation. Review the stack bottom-up so foundational feedback reaches
dependent layers early; distinct domain reviewers may review ready layers
concurrently.

When feedback changes a lower layer, commit the fix on that branch and cascade
it upward:

```bash
gh stack checkout agent/123-model
# Edit, test, validate, and create another signed commit on this layer.
gh stack rebase --upstack
gh stack view --json
# Visit every rewritten layer, rerun its relevant checks, and verify every
# rewritten commit's signature. Run bun run validate from the top layer.
# Return every rewritten layer diff and the assembled top diff to both
# adversarial reviewers; resolve findings and repeat until both clear it.
gh stack push
gh stack view --json
```

Do not push after a rebase until every rewritten layer passes its checks and all
rewritten commits pass local signature verification, and both reviewers have
reviewed the final rewritten stack. Rerun GitHub provenance checks after
pushing. Do not use GitHub rebase-and-merge; ADR 0026 disallows it because it
cannot satisfy the signature contract.

The installed `gh-stack` skill explains merge mechanics, not LoopWorks merge
authority. Agents stop at draft PRs and never run its merge command. Version
0.1.0 does not provide an exact-head lease equivalent to
`gh pr merge --match-head-commit`, so it cannot safely execute a delegated merge
bound to previously reviewed SHAs. A human merger must review the current stack
heads and use GitHub's stack merge UI; if policy requires an automated
exact-head-bound merge, stop rather than falling back to ordinary `gh pr merge`
or an unleased `gh stack merge`.

### Preview constraints

- A stack is linear and all branches must live in the same repository. Use a
  separate stack for a parallel workstream; cross-fork stacks are unsupported.
- Required reviews, status checks, CODEOWNERS, code scanning, and other trunk
  protections apply independently to every PR in the stack.
- Pull-request workflows targeting the trunk run for every layer, so a stack
  multiplies CI usage. Fewer, stronger layers are better than tiny slices.
- A lower-layer defect propagates upward. Self-review and validate a layer
  before adding the next branch.
- GitHub Desktop does not support stacked PRs. Use `gh stack` or GitHub's web
  stack controls.

For the underlying model and current preview behavior, see GitHub's
[stacking tutorial](https://docs.github.com/en/pull-requests/tutorials/stack-code-changes-in-pull-requests)
and [stacked pull request reference](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests).
Graphite's [stack-structure guide](https://graphite.com/docs/how-to-structure-your-stacks)
provides established examples of semantic splitting patterns.

## Git Hooks

Install and run the repository hooks with:

```bash
bun run precommit:install
bun run precommit:run
```

The hook invokes the same `bun run precommit` aggregate gate contributors run
before review.
