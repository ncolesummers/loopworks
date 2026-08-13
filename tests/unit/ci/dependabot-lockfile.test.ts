import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  env?: Record<string, string>;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, boolean | number | string>;
};

type WorkflowJob = {
  if?: string;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
  name?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
};

const repoRoot = path.resolve(__dirname, "../../..");
const generatorPath = path.join(repoRoot, ".github/workflows/dependabot-bun-lock.yml");
const committerPath = path.join(repoRoot, ".github/workflows/dependabot-bun-lock-commit.yml");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function readWorkflow(workflowPath: string): Workflow {
  const source = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
  return (parse(source) ?? {}) as Workflow;
}

const generator = readWorkflow(generatorPath);
const committer = readWorkflow(committerPath);
const ci = readWorkflow(ciPath);
const normalized = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
const githubExpression = (body: string) => `\${{ ${body} }}`;
const shellVariable = (name: string) => `\${${name}}`;

describe("Dependabot Bun lockfile workflows", () => {
  it("generates a lockfile only for same-repository Dependabot package PRs", () => {
    expect(existsSync(generatorPath)).toBe(true);
    expect(generator.on).toEqual({
      pull_request: {
        paths: ["package.json"],
        types: ["opened", "reopened", "synchronize"],
      },
    });
    expect(generator.permissions).toEqual({ contents: "read" });

    const job = generator.jobs?.generate;
    const guard = normalized(job?.if);
    expect(guard).toBe(
      [
        "github.actor == 'dependabot[bot]'",
        "github.event.pull_request.user.login == 'dependabot[bot]'",
        "github.event.pull_request.head.repo.full_name == github.repository",
      ].join(" && "),
    );
    expect(job?.permissions).toBeUndefined();
  });

  it("regenerates bun.lock without executing pull-request lifecycle scripts", () => {
    const steps = generator.jobs?.generate?.steps ?? [];
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({
      "persist-credentials": false,
      ref: githubExpression("github.event.pull_request.head.sha"),
      repository: githubExpression("github.repository"),
    });

    const install = steps.find((step) => step.run?.startsWith("bun install"));
    expect(install?.run).toBe("bun install --ignore-scripts");
    expect(install?.run).not.toContain("--frozen-lockfile");
    expect(steps.some((step) => step.run?.includes("bun run"))).toBe(false);
  });

  it("hands only lockfile data and immutable head metadata to the committer", () => {
    const steps = generator.jobs?.generate?.steps ?? [];
    const stage = steps.find((step) => step.id === "stage");
    expect(stage?.run).toContain("Bun.JSONC.parse");
    expect(stage?.run).toContain('patchedDependencies?.["image-size@2.0.2"]');
    expect(stage?.run).toContain('cp -- bun.lock "$ARTIFACT_PATH/bun.lock"');
    expect(stage?.run).toContain('printf "%s\\n" "$HEAD_SHA" > "$ARTIFACT_PATH/head-sha"');
    expect(stage?.run).toContain(
      'printf "%s\\n" "$PULL_REQUEST_NUMBER" > "$ARTIFACT_PATH/pull-request-number"',
    );

    const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with).toMatchObject({
      name: "dependabot-bun-lock",
      path: `${githubExpression("runner.temp")}/dependabot-bun-lock`,
      "retention-days": 1,
    });
  });

  it("commits artifacts from successful Dependabot generator runs with minimal privilege", () => {
    expect(existsSync(committerPath)).toBe(true);
    expect(committer.on).toEqual({
      workflow_run: {
        types: ["completed"],
        workflows: ["Dependabot Bun lockfile generation"],
      },
    });
    expect(committer.permissions).toEqual({});

    const job = committer.jobs?.commit;
    expect(job?.permissions).toEqual({ actions: "write", contents: "write" });
    const guard = normalized(job?.if);
    expect(guard).toBe(
      [
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.event == 'pull_request'",
        "github.event.workflow_run.actor.login == 'dependabot[bot]'",
        "github.event.workflow_run.head_repository.full_name == github.repository",
      ].join(" && "),
    );
  });

  it("creates a GitHub-signed, expected-head-bound repair without executing PR code", () => {
    const steps = committer.jobs?.commit?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps.every((step) => step.uses === undefined)).toBe(true);
    expect(steps.some((step) => step.run?.includes("bun install"))).toBe(false);
    expect(steps.some((step) => step.run?.includes("bun run"))).toBe(false);

    const commit = steps.find((step) => step.id === "commit");
    expect(commit?.run).toContain('if test "$CURRENT_HEAD" != "$EXPECTED_HEAD"; then');
    expect(commit?.run).toContain(`git rev-parse "${shellVariable("CURRENT_HEAD")}^"`);
    expect(commit?.run).toContain("git diff --no-ext-diff --quiet -- bun.lock");
    expect(commit?.run).toContain("createCommitOnBranch");
    expect(commit?.run).toContain("expectedHeadOid");
    expect(commit?.run).toContain("fileContents");
    expect(commit?.run).toContain('NEW_HEAD="$(printf');
    expect(commit?.run).toContain('dispatch_validation "$CURRENT_HEAD"');
    expect(commit?.run).toContain('dispatch_validation "$NEW_HEAD"');
    expect(commit?.run).toContain('test -n "$EXPECTED_PULL_REQUEST_NUMBER"');
    expect(commit?.run).toContain('test "$PULL_REQUEST_NUMBER" = "$EXPECTED_PULL_REQUEST_NUMBER"');
    expect(commit?.run).toContain('test "$PULL_REQUEST_NUMBER" -gt 0');
    expect(commit?.run).not.toContain("git config");
    expect(commit?.run).not.toContain("git commit");
    expect(commit?.run).not.toContain("git push");
    expect(commit?.run).not.toContain("author:");
    expect(commit?.run).not.toContain("committer:");
  });

  it("dispatches CI on the PR branch and trusted provenance on the default branch", () => {
    expect(ci.on).toMatchObject({ workflow_dispatch: {} });
    const steps = committer.jobs?.commit?.steps ?? [];
    const commit = steps.find((step) => step.id === "commit");
    expect(commit?.run).toContain('gh run download "$RUN_ID"');
    expect(commit?.run).toContain(
      'gh workflow run ci.yml --repo "$HEAD_REPOSITORY" --ref "$HEAD_REF"',
    );
    expect(commit?.run).toContain(
      'gh workflow run commit-provenance.yml --repo "$HEAD_REPOSITORY" --ref "$DEFAULT_BRANCH"',
    );
    expect(commit?.run).toContain(
      '-f "pull_request=$PULL_REQUEST_NUMBER" -f "head_sha=$VALIDATION_HEAD_SHA"',
    );
    expect(commit?.env).toMatchObject({
      DEFAULT_BRANCH: githubExpression("github.event.workflow_run.repository.default_branch"),
      GH_TOKEN: githubExpression("github.token"),
      EXPECTED_PULL_REQUEST_NUMBER: githubExpression(
        "github.event.workflow_run.pull_requests[0].number",
      ),
      HEAD_REF: githubExpression("github.event.workflow_run.head_branch"),
    });
  });
});
