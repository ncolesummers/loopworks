import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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
  "runs-on"?: string;
  "timeout-minutes"?: number;
  steps: WorkflowStep[];
};

type Workflow = {
  on: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
};

const repoRoot = path.resolve(__dirname, "../../..");
const workflow = parse(
  readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
) as Workflow;

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  engines: { node: string };
  scripts: Record<string, string>;
};

/**
 * The gates `bun run validate` chains, read off the script itself. `&&` means a
 * gate that is present but non-blocking in CI is a real divergence, which is why
 * the workflow assertions check for `continue-on-error` and `if` too.
 */
const validateScriptGates = packageJson.scripts.validate
  .split("&&")
  .map((command) => command.trim())
  .filter((command) => command.length > 0);

const probeDirectory = mkdtempSync(path.join(os.tmpdir(), "loopworks-biome-gate-"));

/**
 * The Biome subcommands `bun run validate` actually reaches, resolved through
 * `package.json` rather than named here. Restating them would let the chain drop
 * a Biome gate entirely while this file kept asserting against the old one.
 */
function biomeGatesOfValidate(): { command: string; script: string; subcommand: string }[] {
  return validateScriptGates.flatMap((command) => {
    const script = command.replace(/^bun run /, "");
    const definition = packageJson.scripts[script] ?? "";
    const subcommand = definition.match(/^biome ([a-z:]+)/)?.[1];
    return subcommand ? [{ command, script, subcommand }] : [];
  });
}

function writeProbe(name: string, specifiers: [string, string]): string {
  const probe = path.join(probeDirectory, name);
  writeFileSync(
    probe,
    `import { a } from "${specifiers[0]}";\nimport { b } from "${specifiers[1]}";\n\nexport const value = [a, b];\n`,
  );
  return probe;
}

/**
 * The probe cannot live inside the repository — `biome check .` would then fail
 * the real `validate` — so `--config-path` points Biome at the repo's own
 * `biome.json`. Everything else is left at the settings the real gate uses,
 * including VCS discovery. The installed binary is invoked directly rather than
 * through `bunx`, which can reach the network to resolve a package and would
 * turn a registry hiccup into a hung gate.
 */
function runBiome(subcommand: string, probe: string) {
  const result = spawnSync(
    path.join(repoRoot, "node_modules/.bin/biome"),
    [subcommand, `--config-path=${repoRoot}`, probe],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );
  expect(result.error, `\`biome ${subcommand}\` did not run`).toBeUndefined();
  return result;
}

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
    (step) =>
      step.uses?.startsWith("actions/cache@") === true && step.with?.path?.trim() === cachedPath,
    `actions/cache step for \`${cachedPath}\``,
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

const setupUvV10 = "astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d";
const automaticUvCacheDisabledEvents = ["pull_request_target", "release", "workflow_run"];
const unsafeAutomaticUvCacheWorkflows: [string, Workflow, string][] = [
  [
    "self-hosted runners",
    {
      jobs: { validate: { "runs-on": "self-hosted", steps: [] } },
      on: { pull_request: null, push: { branches: ["main"] }, workflow_dispatch: {} },
    },
    "setup-uv v10 automatic caching requires a GitHub-hosted runner",
  ],
  [
    "tag pushes",
    {
      jobs: { validate: { "runs-on": "ubuntu-latest", steps: [] } },
      on: { pull_request: null, push: { branches: ["main"], tags: ["v*"] }, workflow_dispatch: {} },
    },
    "setup-uv v10 automatic caching must not include tag pushes",
  ],
];

function assertAutomaticUvCacheSafe(candidate: Workflow): void {
  if (candidate.jobs.validate?.["runs-on"] !== "ubuntu-latest") {
    throw new Error("setup-uv v10 automatic caching requires a GitHub-hosted runner");
  }

  const push = candidate.on.push;
  if (
    typeof push !== "object" ||
    push === null ||
    Array.isArray(push) ||
    "tags" in push ||
    JSON.stringify(push) !== JSON.stringify({ branches: ["main"] })
  ) {
    throw new Error("setup-uv v10 automatic caching must not include tag pushes");
  }

  expect(Object.keys(candidate.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
  for (const event of automaticUvCacheDisabledEvents) {
    expect(
      candidate.on[event],
      `CI must not rely on setup-uv's cache for ${event}`,
    ).toBeUndefined();
  }
  expect(candidate.on.pull_request).toBeNull();
}

describe("ci workflow", () => {
  afterAll(() => {
    rmSync(probeDirectory, { force: true, recursive: true });
  });

  it.each(cachingJobs)("bounds the runtime of the `%s` job", (jobName) => {
    const timeout = workflow.jobs[jobName]?.["timeout-minutes"];
    expect(typeof timeout).toBe("number");
    // Loose enough not to churn as the suite grows, tight enough that a hung
    // step fails in minutes rather than at GitHub's six-hour default.
    expect(timeout).toBeGreaterThanOrEqual(10);
    expect(timeout).toBeLessThanOrEqual(60);
  });

  it.each(cachingJobs)("pins the required Node major before Bun in `%s`", (jobName) => {
    const requiredNodeMajor = packageJson.engines.node.match(/^>=(\d+)$/)?.[1];
    expect(requiredNodeMajor, "package.json must declare an exact minimum Node major").toBeTruthy();

    const nodeSteps = stepsOf(jobName).filter((step) =>
      step.uses?.startsWith("actions/setup-node@"),
    );
    expect(nodeSteps, `job \`${jobName}\` must configure Node exactly once`).toHaveLength(1);
    const node = nodeSteps[0];
    expect(node).toBeDefined();
    if (!node) return;
    expect(node.uses).toMatch(/^actions\/setup-node@/);
    expect(node.with?.["node-version"]).toBe(requiredNodeMajor);
    expect(node.if, "Node setup must not be conditional").toBeUndefined();
    expect(node["continue-on-error"], "Node setup must be blocking").toBeUndefined();

    const nodeIndex = stepsOf(jobName).indexOf(node);
    const bunIndex = indexOfStep(
      jobName,
      (step) => step.uses?.startsWith("oven-sh/setup-bun@") === true,
      "oven-sh/setup-bun step",
    );

    expect(nodeIndex).toBeLessThan(bunIndex);
  });

  it("uses setup-uv v10 automatic caching only on its safe CI triggers", () => {
    const setupUv = stepsOf("validate").find((step) => step.name === "Setup uv");

    expect(setupUv?.uses).toBe(setupUvV10);
    expect(setupUv?.with?.["enable-cache"]).toBeUndefined();

    // setup-uv v10 defaults `enable-cache` to `auto`, which disables caching
    // for self-hosted runners and these privileged, tag-push, or
    // publish-triggered events to prevent poisoning.
    assertAutomaticUvCacheSafe(workflow);
  });

  it.each(unsafeAutomaticUvCacheWorkflows)(
    "rejects v10 automatic caching on %s",
    (_scenario, unsafeWorkflow, error) => {
      expect(() => assertAutomaticUvCacheSafe(unsafeWorkflow)).toThrow(error);
    },
  );

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

    // Restoring the cache is an optimisation, not a precondition. The cache
    // holds browser binaries only, so a fresh runner still needs the system
    // packages `--with-deps` installs; and the browser *set* is not part of the
    // key, so gating on `cache-hit` would let a newly configured browser hit
    // this chromium-only cache and never download. On a hit it is a no-op.
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
    // Derived from the script rather than restated, so that adding a gate to
    // `validate` without adding it to CI fails here. A second hand-maintained
    // list would just recreate the drift this is meant to catch.
    expect(validateScriptGates.length).toBeGreaterThan(0);
    expectBlockingGates("validate", validateScriptGates);
  });

  it("keeps the auth bypass on the validate Playwright step", () => {
    const step = stepsOf("validate").find((candidate) => candidate.run === "bun run test:e2e");
    expect(step?.env?.LOOPWORKS_AUTH_BYPASS).toBe("true");
  });

  it("gates Biome assists, not just the formatter and linter", () => {
    // `organizeImports` is an assist, and assists run under `biome check` only:
    // `biome format` and `biome lint` both exit 0 on unsorted imports, so a
    // chain built from those two lets them through every gate we have.
    const gates = biomeGatesOfValidate();
    expect(
      gates.map((gate) => gate.script),
      "no gate in `bun run validate` invokes Biome at all",
    ).not.toHaveLength(0);

    const sorted = writeProbe("sorted.ts", ["./earlier", "./later"]);
    const unsorted = writeProbe("unsorted.ts", ["./later", "./earlier"]);

    const rejecting = gates.filter((gate) => {
      // The control run is what stops this test from passing vacuously. A
      // renamed flag, an unparseable config, or a missing binary makes *every*
      // invocation exit non-zero, including this one — so a broken gate fails
      // here rather than masquerading as a gate that caught something.
      expect(
        runBiome(gate.subcommand, sorted).status,
        `\`${gate.command}\` rejects sorted imports`,
      ).toBe(0);

      const result = runBiome(gate.subcommand, unsorted);
      if (result.status === 0) {
        return false;
      }

      // Non-zero alone would also be satisfied by an unrelated diagnostic, so
      // the rule that fired has to be the assist this issue is about.
      expect(
        `${result.stdout}${result.stderr}`,
        `\`${gate.command}\` failed for some other reason`,
      ).toContain("assist/source/organizeImports");
      return true;
    });

    expect(
      rejecting.map((gate) => gate.script),
      "no gate in `bun run validate` rejects unsorted imports",
    ).not.toHaveLength(0);
  });

  it("still runs both seeded Postgres gates", () => {
    expectBlockingGates("seeded-postgres-e2e", [
      "bun run test:integration:postgres",
      "bun run test:e2e:seeded",
    ]);
  });
});

describe("check-run names", () => {
  it("keeps every pull-request job name unique across workflows", () => {
    // A job with no `name:` publishes a check run named after its job id, and a
    // required status check selects by that name alone. Two workflows that both
    // run on a pull request and both define `validate` therefore publish two
    // check runs under one name, and requiring it cannot express which must
    // pass — a red CI run and a green provenance run look the same to the rule.
    // #235 requires these contexts on `main`, so uniqueness is a precondition
    // rather than a style preference.
    const directory = path.join(repoRoot, ".github/workflows");
    const owners = new Map<string, string[]>();

    for (const file of readdirSync(directory).filter((name) => name.endsWith(".yml"))) {
      const parsed = parse(readFileSync(path.join(directory, file), "utf8")) as {
        on?: Record<string, unknown> | string[] | string;
        jobs?: Record<string, { name?: string }>;
      };
      // `pull_request_target` publishes onto the pull-request head exactly as
      // `pull_request` does, so both feed the same context namespace.
      const triggers = parsed.on ?? {};
      const triggerNames = Array.isArray(triggers)
        ? triggers
        : typeof triggers === "string"
          ? [triggers]
          : Object.keys(triggers);
      if (!triggerNames.some((name) => name.startsWith("pull_request"))) continue;

      for (const [id, job] of Object.entries(parsed.jobs ?? {})) {
        const context = job.name ?? id;
        owners.set(context, [...(owners.get(context) ?? []), file]);
      }
    }

    expect(owners.size, "no pull-request jobs found to check").toBeGreaterThan(0);
    const collisions = [...owners.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([context, files]) => `${context} <- ${files.join(", ")}`);
    expect(collisions, "two pull-request jobs publish the same check-run name").toEqual([]);
  });
});
