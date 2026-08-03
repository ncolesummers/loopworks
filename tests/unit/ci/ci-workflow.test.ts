import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};

type WorkflowJob = {
  "timeout-minutes"?: number;
  steps: WorkflowStep[];
};

type Workflow = {
  jobs: Record<string, WorkflowJob>;
};

const workflowPath = path.resolve(__dirname, "../../../.github/workflows/ci.yml");
const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

/** Both jobs check out, install, and drive Playwright, so both must cache. */
const cachingJobs = ["validate", "seeded-postgres-e2e"] as const;

function stepsOf(jobName: string): WorkflowStep[] {
  const job = workflow.jobs[jobName];
  expect(job, `job \`${jobName}\` is missing from ci.yml`).toBeDefined();
  return job.steps;
}

function indexOfStep(
  jobName: string,
  predicate: (step: WorkflowStep) => boolean,
  description: string,
): number {
  const index = stepsOf(jobName).findIndex(predicate);
  expect(index, `job \`${jobName}\` has no ${description}`).toBeGreaterThanOrEqual(0);
  return index;
}

/**
 * Matches on the exact cached path and a pinned action revision. A substring
 * match would accept `~/.bun/install/cache-unused`, which restores nothing, and
 * an unpinned `uses` would accept a revision that does not exist — GitHub fails
 * the job before any step runs.
 */
function cacheIndexFor(jobName: string, cachedPath: string): number {
  return indexOfStep(
    jobName,
    (step) => step.uses === "actions/cache@v4" && step.with?.path?.trim() === cachedPath,
    `actions/cache@v4 step for \`${cachedPath}\``,
  );
}

/**
 * Wraps an expression in the delimiters GitHub evaluates. Outside `if`, a bare
 * expression is literal text, so a key missing these never invalidates.
 */
const githubExpression = (body: string) => `\${{ ${body} }}`;

const isVersionResolver = (step: WorkflowStep) =>
  step.run?.includes("@playwright/test/package.json") === true;

const isBrowserInstall = (step: WorkflowStep) =>
  step.run?.includes("playwright install --with-deps chromium") === true;

describe("ci workflow", () => {
  it.each(cachingJobs)("bounds the runtime of the `%s` job", (jobName) => {
    const timeout = workflow.jobs[jobName]?.["timeout-minutes"];
    expect(typeof timeout).toBe("number");
    // Loose enough not to churn as the suite grows, tight enough that a hung
    // step fails in minutes rather than at GitHub's six-hour default.
    expect(timeout).toBeGreaterThanOrEqual(10);
    expect(timeout).toBeLessThanOrEqual(60);
  });

  it.each(cachingJobs)("caches the Bun install store in `%s`", (jobName) => {
    const cache = stepsOf(jobName)[cacheIndexFor(jobName, "~/.bun/install/cache")];
    const key = cache.with?.key ?? "";

    // bun.lock pins every resolved version, so its hash covers the store's
    // contents; the Bun version covers the store's on-disk layout.
    expect(key).toContain(githubExpression("hashFiles('bun.lock')"));

    const setupBun = stepsOf(jobName).find((step) => step.uses?.startsWith("oven-sh/setup-bun@"));
    const bunVersion = setupBun?.with?.["bun-version"];
    expect(bunVersion, `job \`${jobName}\` does not pin a Bun version`).toBeTruthy();
    expect(key).toContain(`bun${bunVersion}`);

    // An accumulating store would grow without bound across lockfile bumps,
    // since every miss re-saves the union of the restored and new tarballs.
    expect(cache.with?.["restore-keys"]).toBeUndefined();
  });

  it.each(cachingJobs)("resolves the Playwright version before caching in `%s`", (jobName) => {
    const resolverIndex = indexOfStep(
      jobName,
      isVersionResolver,
      "step resolving the installed Playwright version",
    );
    const installIndex = indexOfStep(
      jobName,
      (step) => step.run?.includes("bun install --frozen-lockfile") === true,
      "dependency install step",
    );
    const cacheIndex = cacheIndexFor(jobName, "~/.cache/ms-playwright");
    const resolver = stepsOf(jobName)[resolverIndex];

    // The version comes out of node_modules, so it must be read after install;
    // and it has to be read before the cache step or the key silently
    // degrades to a constant that never invalidates.
    expect(installIndex).toBeLessThan(resolverIndex);
    expect(resolverIndex).toBeLessThan(cacheIndex);
    expect(resolver.id).toBeTruthy();

    // The step must actually publish the output the key reads. A missing or
    // renamed output resolves to an empty string, collapsing every version onto
    // the same constant key instead of failing loudly.
    expect(resolver.run).toContain('echo "version=$version" >> "$GITHUB_OUTPUT"');

    const cache = stepsOf(jobName)[cacheIndex];
    // A literal version would silently serve stale browsers after an upgrade.
    expect(cache.with?.key).toContain(githubExpression(`steps.${resolver.id}.outputs.version`));
  });

  it.each(cachingJobs)("installs Playwright browsers unconditionally in `%s`", (jobName) => {
    const cacheIndex = cacheIndexFor(jobName, "~/.cache/ms-playwright");
    const installIndex = indexOfStep(jobName, isBrowserInstall, "Playwright browser install step");
    const install = stepsOf(jobName)[installIndex];

    // Restoring the cache is an optimisation, not a precondition. Gating the
    // install on `cache-hit` makes a partial or stale cache permanently fatal,
    // because cache entries are immutable and a truncated save would then be
    // restored forever. Running the install every time repairs such a cache and
    // picks up any newly required browser; on a hit it is a no-op.
    expect(install.if, `job \`${jobName}\` gates the browser install on the cache`).toBeUndefined();
    expect(cacheIndex).toBeLessThan(installIndex);
  });

  /**
   * Presence alone would not prove a gate still fails the build: both
   * `continue-on-error` and an unsatisfiable `if` leave the command string in
   * place while CI stops enforcing it.
   */
  function expectBlockingGates(jobName: string, gates: string[]) {
    const steps = stepsOf(jobName);
    for (const gate of gates) {
      const step = steps.find((candidate) => candidate.run === gate);
      expect(step, `job \`${jobName}\` no longer runs \`${gate}\``).toBeDefined();
      expect(step?.["continue-on-error"], `\`${gate}\` is non-blocking`).toBeUndefined();
      expect(step?.if, `\`${gate}\` is conditional`).toBeUndefined();
    }
  }

  it("runs the same blocking gates as `bun run validate`", () => {
    expectBlockingGates("validate", [
      "bun run format:check",
      "bun run lint",
      "bun run agent-docs:check",
      "bun run config:check",
      "bun run config:access-check",
      "bun run markdownlint",
      "bun run typecheck",
      "bun run test",
      "bun run storybook:build",
      "bun run test:e2e",
    ]);
  });

  it("keeps the auth bypass on the validate Playwright step", () => {
    const step = stepsOf("validate").find((candidate) => candidate.run === "bun run test:e2e");
    expect(step?.env?.LOOPWORKS_AUTH_BYPASS).toBe("true");
  });

  it("still runs both seeded Postgres gates", () => {
    expectBlockingGates("seeded-postgres-e2e", [
      "bun run test:integration:postgres",
      "bun run test:e2e:seeded",
    ]);
  });
});
