import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, boolean | number | string>;
};

type Workflow = {
  jobs?: Record<
    string,
    { if?: string; permissions?: Record<string, string>; steps?: WorkflowStep[] }
  >;
  on?: {
    pull_request?: unknown;
    pull_request_target?: unknown;
    workflow_dispatch?: { inputs?: Record<string, unknown> };
  };
  permissions?: Record<string, string>;
};

const repoRoot = path.resolve(__dirname, "../../..");
const workflow = parse(
  readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
) as Workflow;
const trustedWorkflow = parse(
  readFileSync(path.join(repoRoot, ".github/workflows/commit-provenance.yml"), "utf8"),
) as Workflow;
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const githubExpression = (body: string) => `\${{ ${body} }}`;

describe("commit provenance CI contract", () => {
  it("keeps ordinary CI dispatch manual and moves provenance to pull_request_target", () => {
    expect(workflow.on?.workflow_dispatch).toEqual({});
    expect(workflow.permissions).toEqual({ contents: "read" });
    // Across every job in ci.yml rather than one named job: the provenance gate
    // must not reappear in ordinary CI under any job name.
    expect(
      Object.values(workflow.jobs ?? {}).some((job) =>
        job.steps?.some((step) => step.name === "Commit provenance"),
      ),
    ).toBe(false);

    expect(trustedWorkflow.on?.pull_request_target).toEqual({
      types: ["opened", "reopened", "synchronize"],
    });
    expect(trustedWorkflow.on?.workflow_dispatch?.inputs).toMatchObject({
      pull_request: { required: true, type: "string" },
      head_sha: { required: true, type: "string" },
    });
    expect(trustedWorkflow.permissions).toEqual({});

    const job = trustedWorkflow.jobs?.provenance;
    expect(job?.if).toContain("github.ref_name == github.event.repository.default_branch");
    expect(job?.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
      statuses: "write",
    });
    const steps = job?.steps ?? [];
    const resolve = steps.find((step) => step.id === "resolve");
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    const provenance = steps.find((step) => step.name === "Run provenance check");
    const pendingStatus = steps.find((step) => step.name === "Publish pending status");
    const status = steps.find((step) => step.name === "Publish provenance status");

    expect(resolve?.run).toContain("gh api");
    expect(resolve?.run).toContain(".head.sha");
    expect(resolve?.run).toContain(".base.ref");
    expect(resolve?.run).toContain("current head SHA");
    expect(checkout?.with).toMatchObject({
      "persist-credentials": false,
      ref: githubExpression("steps.resolve.outputs.base_ref"),
      repository: githubExpression("github.repository"),
    });
    expect(String(checkout?.with?.ref)).not.toContain("head.sha");
    expect(provenance?.run).toBe('bun run commit:provenance --github "$PULL_REQUEST_NUMBER"');
    expect(provenance?.env).toMatchObject({ GH_TOKEN: githubExpression("github.token") });
    expect(pendingStatus?.run).toContain("statuses/$HEAD_SHA");
    expect(pendingStatus?.run).toContain("state=pending");
    expect(status?.run).toContain("statuses/$HEAD_SHA");
    expect(status?.run).toContain("pulls/$PULL_REQUEST_NUMBER");
    expect(status?.run).toContain("STATE=success");
    expect(status?.run).toContain("STATE=failure");
    expect(status?.run).toContain("commit-provenance");
    expect(
      trustedWorkflow.jobs?.provenance?.steps?.some((step) =>
        step.uses?.startsWith("actions/checkout@"),
      ),
    ).toBe(true);
    expect(
      trustedWorkflow.jobs?.provenance?.steps?.some((step) => step.run?.includes("head.sha")),
    ).toBe(true);
    expect(packageJson.scripts["commit:provenance"]).toBe(
      "bun run scripts/check-commit-provenance.ts",
    );
  });
});
