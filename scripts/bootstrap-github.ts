import { spawnSync } from "node:child_process";

type Label = {
  name: string;
  color: string;
  description: string;
};

type IssueSeed = {
  title: string;
  milestone: string;
  labels: string[];
  body: string;
};

type ExistingIssue = {
  number: number;
  url: string;
  body: string;
  labels: string[];
  milestone?: string;
};

type ExistingMilestone = {
  number: number;
  title: string;
  description: string | null;
};

const owner = process.env.GITHUB_OWNER ?? "ncolesummers";
const repo = process.env.GITHUB_REPO ?? "loopworks";
const repository = `${owner}/${repo}`;
const projectTitle = "Loopworks Backlog";

const milestones = [
  {
    title: "M0 Project Foundation",
    description: "Repo scaffold, PRD, ADR baseline, tooling, CI, and planning bootstrap.",
  },
  {
    title: "M1 Design System Direction + App Shell",
    description:
      "Early design direction, ShadCN conventions, shell, navigation, Storybook taxonomy, and persona-driven test planning.",
  },
  {
    title: "M2 GitHub + Vercel Source Systems",
    description:
      "GitHub SSO/App/webhooks/dev fixtures, repo catalog, and Vercel deployment visibility.",
  },
  {
    title: "M3 Durable Loop MVP",
    description:
      "Loop registry, agent-ready triggers, run timelines, artifacts, approvals, and planning agent.",
  },
  {
    title: "M4 Validation + PR Path + MVP Security Review",
    description: "Deterministic validation, PR creation path, and required MVP security review.",
  },
  {
    title: "M5 Agent Governance + Evals",
    description:
      "Loop governance, ADR lifecycle, proposed diffs, model/prompt/workflow evals, and approval policy hardening.",
  },
];

const labels: Label[] = [
  { name: "agent-ready", color: "0E8A16", description: "Issue can trigger an agentic workflow." },
  { name: "spike", color: "5319E7", description: "Deep research or discovery work." },
  {
    name: "needs-approval",
    color: "D93F0B",
    description: "Human approval is required before advancing.",
  },
  {
    name: "adr-proposed",
    color: "FBCA04",
    description: "Durable decision should become a proposed ADR.",
  },
  {
    name: "area:adr",
    color: "BFDADC",
    description: "Architecture decision records and durable decision governance.",
  },
  { name: "loop:development", color: "1D76DB", description: "Development loop work." },
  { name: "loop:research", color: "5319E7", description: "Research loop work." },
  {
    name: "area:github",
    color: "24292F",
    description: "GitHub integration and source-of-truth behavior.",
  },
  {
    name: "area:vercel",
    color: "000000",
    description: "Vercel project, deployment, preview, or log visibility.",
  },
  {
    name: "area:control-plane",
    color: "0052CC",
    description: "Run state, events, locking, and persistence.",
  },
  { name: "area:catalog", color: "0366D6", description: "Repo/service catalog behavior." },
  {
    name: "area:loops",
    color: "1D76DB",
    description: "Loop registry, manifests, and execution stages.",
  },
  {
    name: "area:agents",
    color: "6F42C1",
    description: "Eve agents, planning, tools, and prompts.",
  },
  {
    name: "area:validation",
    color: "0E8A16",
    description: "Tests, typecheck, linting, a11y, security, and release gates.",
  },
  {
    name: "area:observability",
    color: "0052CC",
    description: "Structured logs, metrics, traces, alerts, and operational visibility.",
  },
  {
    name: "area:ui",
    color: "C5DEF5",
    description: "Portal UI, ShadCN components, Storybook, and flows.",
  },
  {
    name: "area:docs",
    color: "BFDADC",
    description: "Product, architecture, ADR, and contributor documentation.",
  },
  {
    name: "area:infra",
    color: "0052CC",
    description: "CI, deployment, databases, and local development infrastructure.",
  },
  {
    name: "area:design-system",
    color: "F9D0C4",
    description: "Design system direction, tokens, density, and component rules.",
  },
  {
    name: "area:security",
    color: "B60205",
    description: "Threat modeling, reviews, auth, tokens, and hardening.",
  },
  { name: "priority:p0", color: "B60205", description: "Critical path for the current milestone." },
  { name: "priority:p1", color: "D93F0B", description: "High priority after P0 work." },
  { name: "priority:p2", color: "FBCA04", description: "Important but not immediately blocking." },
  { name: "priority:p3", color: "C2E0C6", description: "Nice-to-have or later hardening." },
];

const managedLabelNames = new Set(labels.map((label) => label.name));

const issues: IssueSeed[] = [
  {
    title: "Create PRD and architecture baseline",
    milestone: "M0 Project Foundation",
    labels: ["area:docs", "priority:p0"],
    body: issueBody({
      summary:
        "Create and maintain the product and architecture baseline that future Loopworks work should reference.",
      deliverables: [
        "PRD covering goals, source-of-truth model, MVP scope, Vercel visibility, loop concepts, validation philosophy, and roadmap.",
        "Architecture note covering boundaries, data ownership, webhook idempotency, control-plane state, manifest governance, and validation order.",
        "Loop manifest guidance and security/design-system planning notes.",
      ],
      acceptance: [
        "Docs explain why GitHub owns planning state while Loopworks owns run/control-plane state.",
        "MVP milestones and exit criteria are clear enough to seed GitHub backlog issues.",
        "Docs include the early design-system issue and end-of-MVP security review requirement.",
      ],
    }),
  },
  {
    title: "Initialize Next.js, Bun, ShadCN, and repository tooling",
    milestone: "M0 Project Foundation",
    labels: ["area:infra", "area:ui", "priority:p0"],
    body: issueBody({
      summary:
        "Scaffold the app and repository quality gates so all subsequent work starts from a validated baseline.",
      deliverables: [
        "Next.js App Router app using Bun, TypeScript, Tailwind, and ShadCN/UI primitives.",
        "Biome, Vitest, Playwright, Storybook, Storybook build, TypeScript typecheck, and aggregate validation scripts.",
        "CI workflow that mirrors local validation.",
      ],
      acceptance: [
        "`bun run validate` passes locally.",
        "CI runs format, lint, typecheck, tests, Storybook build, and Playwright.",
        "README documents local setup and expected environment variables.",
      ],
    }),
  },
  {
    title: "Structured logging and observability foundation",
    milestone: "M0 Project Foundation",
    labels: ["area:observability", "area:control-plane", "priority:p0"],
    body: issueBody({
      summary:
        "Establish Pino structured logging and the initial observability contract before agent workflows become more autonomous.",
      deliverables: [
        "Shared Pino logger with service metadata, `LOG_LEVEL` support, and default secret/token redaction.",
        "Request-scoped logging at GitHub webhook, Vercel deployment, approval transition, and loop manifest API boundaries.",
        "Observability documentation covering correlation ids, durable event-store boundaries, metrics, traces, and review checklist.",
      ],
      acceptance: [
        "Logs use structured fields for route, GitHub delivery id, repository, loop/run identifiers, approval actor, Vercel project, and fallback reasons where available.",
        "Tests cover logger redaction and at least one integration fallback logging path.",
        "Docs state that logs are not the event store and that durable run/control-plane state must still be persisted.",
      ],
    }),
  },
  {
    title: "Review foundational ADRs and decision lifecycle",
    milestone: "M1 Design System Direction + App Shell",
    labels: ["area:adr", "area:docs", "adr-proposed", "priority:p0"],
    body: issueBody({
      summary:
        "Review the initial ADR set and make ADR creation part of the normal Loopworks planning workflow.",
      deliverables: [
        "Review ADRs for GitHub source-of-truth, Vercel stack, Pino observability, Drizzle, ShadCN, testing strategy, and fixture policy.",
        "Ratify the accepted baseline, identify any superseding follow-ups, and document which future decisions should start as proposed.",
        "Document when agents and maintainers must add, update, supersede, or link ADRs from GitHub issues.",
      ],
      acceptance: [
        "ADR index reflects current status for each foundational decision.",
        "Design-system planning outcomes update or supersede the ShadCN/design ADR if needed.",
        "New architecture-changing issues include an ADR expectation in acceptance criteria where relevant.",
      ],
    }),
  },
  {
    title: "Implement persona-derived MVP acceptance tests",
    milestone: "M1 Design System Direction + App Shell",
    labels: ["area:validation", "area:ui", "priority:p0"],
    body: issueBody({
      summary:
        "Turn the product personas into executable MVP acceptance coverage across Playwright, Storybook, and focused unit/integration tests.",
      deliverables: [
        "Map Product Operator, Maintainer, Agent Supervisor, Reviewer, and Security Reviewer scenarios to MVP issues.",
        "Add Playwright coverage for dashboard, catalog, Vercel visibility, loop toggles, run timeline, approvals, and sign-in guard flows.",
        "Add unit/integration coverage for high-risk persona edges such as trigger classification, disabled loops, production fixture blocking, webhook signatures, idempotency, and logger redaction.",
      ],
      acceptance: [
        "Each MVP milestone references relevant persona test ids from the docs matrix.",
        "Playwright coverage exercises full user workflows instead of only page loads.",
        "Storybook includes state variations needed by the persona scenarios.",
      ],
    }),
  },
  {
    title: "Design system direction and token planning",
    milestone: "M1 Design System Direction + App Shell",
    labels: ["area:design-system", "area:ui", "priority:p0"],
    body: issueBody({
      summary:
        "Run the dedicated design-system planning pass before broad UI expansion so Loopworks does not accidentally settle into generic ShadCN defaults.",
      deliverables: [
        "Brand and product feel decision for an agentic software factory control plane.",
        "Initial semantic tokens for state, workflow, deployment, validation, and approvals.",
        "Storybook taxonomy and design review checklist for future UI work.",
      ],
      acceptance: [
        "Temporary M0 theme is clearly separated from durable M1 token decisions.",
        "Status vocabulary is defined for loading, empty, disabled, pending, running, blocked, failed, approved, rejected, and done.",
        "Reusable component priorities are listed for catalog, loops, runs, approvals, deployments, and empty/error/loading states.",
      ],
    }),
  },
  {
    title: "Authenticated app shell and navigation",
    milestone: "M1 Design System Direction + App Shell",
    labels: ["area:ui", "priority:p0"],
    body: issueBody({
      summary:
        "Build the authenticated portal shell that frames every MVP workflow and keeps operational state visible.",
      deliverables: [
        "Responsive shell with navigation for dashboard, catalog, loops, runs, approvals, deployments, and settings.",
        "Shared empty, loading, error, disabled, and unauthorized states.",
        "Storybook stories for shell and core dashboard states.",
      ],
      acceptance: [
        "Shell works at mobile, laptop, and desktop widths without text overlap.",
        "Protected app routes share a consistent signed-in user and permission surface.",
        "Playwright covers initial dashboard load and navigation between MVP slices.",
      ],
    }),
  },
  {
    title: "GitHub SSO with owner/org allowlist",
    milestone: "M2 GitHub + Vercel Source Systems",
    labels: ["area:github", "area:security", "priority:p0"],
    body: issueBody({
      summary:
        "Use GitHub as the identity provider and enforce a small, explicit access policy for the early portal.",
      deliverables: [
        "Auth.js GitHub provider using `AUTH_SECRET`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET`.",
        "Configured username/org allowlist for portal access.",
        "Persisted user identity for audit, approvals, and future run attribution.",
      ],
      acceptance: [
        "Unauthorized users cannot access protected app routes.",
        "Allowlist logic has unit coverage for username, org, and denied cases.",
        "Approval records can reference the authenticated GitHub identity.",
      ],
    }),
  },
  {
    title: "GitHub App webhook and dev fixture intake",
    milestone: "M2 GitHub + Vercel Source Systems",
    labels: ["area:github", "area:control-plane", "priority:p0"],
    body: issueBody({
      summary:
        "Create the safe intake path for GitHub issue events that will eventually trigger agentic loops.",
      deliverables: [
        "Webhook API route with signature verification and delivery id extraction.",
        "Idempotency and lock records for repeated deliveries.",
        "Local signed fixture path for `agent-ready` and `spike` issue events.",
      ],
      acceptance: [
        "Invalid signatures are rejected before payload processing.",
        "Repeated delivery ids do not create duplicate runs.",
        "`agent-ready` and `spike` plus `agent-ready` events normalize into distinct trigger classifications.",
      ],
    }),
  },
  {
    title: "Repo catalog MVP",
    milestone: "M2 GitHub + Vercel Source Systems",
    labels: ["area:catalog", "area:github", "priority:p0"],
    body: issueBody({
      summary:
        "Build the Backstage-style catalog surface that lets operators understand each connected repository.",
      deliverables: [
        "Catalog data model for owner, framework, default branch, CI commands, docs, observability, design system links, enabled loops, and Vercel project mapping.",
        "Catalog UI with search/filter-friendly structure.",
        "Fixture data that exercises empty, loading, healthy, blocked, and disconnected states.",
      ],
      acceptance: [
        "Operators can see which loops and validation gates are enabled for each repo.",
        "Catalog rows/cards link to GitHub, docs, observability, design system, and Vercel where configured.",
        "Storybook and Playwright cover the catalog MVP view.",
      ],
    }),
  },
  {
    title: "Vercel deployment and preview visibility",
    milestone: "M2 GitHub + Vercel Source Systems",
    labels: ["area:vercel", "area:ui", "priority:p0"],
    body: issueBody({
      summary: "Make it easy to check the built application and previews from within Loopworks.",
      deliverables: [
        "Vercel client using `VERCEL_ACCESS_TOKEN` and optional team slug/id.",
        "Repo-to-Vercel project mapping in the catalog.",
        "Deployment view showing production and preview status, URL, branch, commit, age, event/log summary, and Vercel links.",
      ],
      acceptance: [
        "Fixture data can render ready, building, errored, preview, and production states.",
        "API mapping has unit coverage for deployment status and commit metadata.",
        "Playwright covers the Vercel deployment overview.",
      ],
    }),
  },
  {
    title: "Seed data and fixture operating model",
    milestone: "M2 GitHub + Vercel Source Systems",
    labels: ["area:infra", "area:validation", "area:control-plane", "priority:p1"],
    body: issueBody({
      summary:
        "Create a deliberate seed and fixture strategy so local development stays inspectable without masking production gaps.",
      deliverables: [
        "Seeded demo data for repos, loop definitions, runs, run steps, artifacts, approvals, and Vercel deployment states.",
        "Reset/reseed workflow after the database bootstrap exists.",
        "Fixture fallback policy and tests proving production does not silently use stand-in data.",
      ],
      acceptance: [
        "Fixture data covers empty, loading, healthy, disabled, blocked, failed, pending approval, approved, rejected, production, preview, and disconnected states.",
        "API responses and logs identify fixture/fallback reasons without exposing secrets.",
        "Production environments fail closed when required credentials or durable stores are missing.",
      ],
    }),
  },
  {
    title: "Loop manifest schema and governance draft",
    milestone: "M3 Durable Loop MVP",
    labels: ["area:loops", "area:control-plane", "priority:p0"],
    body: issueBody({
      summary:
        "Define the early loop manifest contract so loop behavior is configurable, reviewable, and testable.",
      deliverables: [
        "Versioned schema covering triggers, enabled state, repo scope, labels, schedules, model policy, budgets, approvals, artifact contracts, validation gates, retries, concurrency, and cancellation.",
        "Schema validation utilities and sample development-loop manifest.",
        "Governance note for proposed diffs, evals, and PR review of loop changes.",
      ],
      acceptance: [
        "Invalid manifests return actionable validation errors.",
        "Manifest tests cover enabled/disabled state, trigger labels, validation gates, approvals, retries, and concurrency.",
        "Docs explain how manifest changes are governed before rollout.",
      ],
    }),
  },
  {
    title: "Agent-ready development loop skeleton",
    milestone: "M3 Durable Loop MVP",
    labels: ["area:loops", "area:agents", "loop:development", "priority:p0"],
    body: issueBody({
      summary: "Implement the first durable loop skeleton for issues labeled `agent-ready`.",
      deliverables: [
        "Development loop stages for planning, test-writing, development, validation, code review, commit, PR, and done.",
        "Run creation from an issue trigger or dev fixture.",
        "Stage transition rules with deterministic validation before LLM judgment.",
      ],
      acceptance: [
        "`agent-ready` fixture can create or simulate a run.",
        "Each stage emits a visible timeline step and artifact contract.",
        "Disabled loops do not trigger and record a skipped/no-op reason.",
      ],
    }),
  },
  {
    title: "Run timeline, artifacts, and approval gates",
    milestone: "M3 Durable Loop MVP",
    labels: ["area:control-plane", "area:ui", "needs-approval", "priority:p0"],
    body: issueBody({
      summary:
        "Give operators a durable and inspectable record of what a loop did and what it needs next.",
      deliverables: [
        "Run detail UI with timeline steps, statuses, timestamps, validation evidence, artifacts, and external links.",
        "Approval gate component with requested, approved, rejected, bypassed, and expired states.",
        "Persistence model for run steps, artifacts, approvals, and status transitions.",
      ],
      acceptance: [
        "Operators can identify blocked and waiting-for-approval runs at a glance.",
        "Approval transitions are tested and require authenticated attribution.",
        "Storybook covers timeline, artifacts, and approval gate states.",
      ],
    }),
  },
  {
    title: "Initial Eve planning agent",
    milestone: "M3 Durable Loop MVP",
    labels: ["area:agents", "loop:development", "priority:p1"],
    body: issueBody({
      summary:
        "Create the first Eve-based agent skeleton focused on planning, not autonomous code mutation.",
      deliverables: [
        "Planning-agent instructions and runtime configuration.",
        "Tool contracts for reading issue context, writing plan artifacts, and summarizing validation requirements.",
        "Fixture execution path for local development.",
      ],
      acceptance: [
        "Agent output is an executable plan artifact with stages, validation gates, approval points, and risks.",
        "Agent tools are narrow and auditable.",
        "Future model/prompt/tool changes have a path to eval coverage.",
      ],
    }),
  },
  {
    title: "Metrics and trace backend decision",
    milestone: "M3 Durable Loop MVP",
    labels: ["area:observability", "area:control-plane", "adr-proposed", "priority:p1"],
    body: issueBody({
      summary:
        "Choose the first metrics backend and trace collector before durable loop execution becomes broad.",
      deliverables: [
        "Compare practical backend options for metrics, traces, alerting, retention, and Vercel runtime fit.",
        "Define metric names for run counts, step duration, validation outcomes, webhook outcomes, deployment health, approval wait time, queue depth, lock contention, retries, cancellations, model usage, and cost.",
        "Create or update the ADR for telemetry backend choice and rollout plan.",
      ],
      acceptance: [
        "Decision includes local development, Vercel deployment, and production retention implications.",
        "Correlation fields line up with Pino logs, database records, artifacts, and future traces.",
        "Follow-up implementation issues exist for instrumentation, dashboards, and alerts.",
      ],
    }),
  },
  {
    title: "Deterministic validation hooks",
    milestone: "M4 Validation + PR Path + MVP Security Review",
    labels: ["area:validation", "priority:p0"],
    body: issueBody({
      summary: "Make deterministic checks the first-class evidence for whether work can advance.",
      deliverables: [
        "Validation contracts for format, lint/static analysis, typecheck, unit/integration tests, Playwright, a11y, Lighthouse where relevant, and security checks where relevant.",
        "Run-step artifact format for validation output.",
        "UI summary for pass/fail/skipped validation gates.",
      ],
      acceptance: [
        "Validation runs before LLM review and before PR creation.",
        "Failures block downstream stages unless an explicit approval policy allows continuation.",
        "Validation summaries link to raw artifacts where available.",
      ],
    }),
  },
  {
    title: "PR creation path",
    milestone: "M4 Validation + PR Path + MVP Security Review",
    labels: ["area:github", "area:loops", "priority:p1"],
    body: issueBody({
      summary:
        "Create the guarded path from validated loop output to a GitHub pull request or dev-mode PR intent.",
      deliverables: [
        "Branch, commit, and PR creation plan with explicit permissions and approval gates.",
        "Dev-mode PR intent artifact for local testing without mutating GitHub.",
        "PR summary that includes validation evidence, artifacts, issue links, and deployment context.",
      ],
      acceptance: [
        "PR creation cannot run until required validation and approval gates pass.",
        "Created PRs link back to the source issue and Loopworks run.",
        "Failures produce retryable, inspectable run steps.",
      ],
    }),
  },
  {
    title: "MVP security review",
    milestone: "M4 Validation + PR Path + MVP Security Review",
    labels: ["area:security", "priority:p0"],
    body: issueBody({
      summary: "Complete a focused security review before calling the MVP shippable.",
      deliverables: [
        "Review auth/session handling and route protection.",
        "Review GitHub webhook verification, replay/idempotency handling, and lock behavior.",
        "Review token storage, Vercel token scope, approval bypasses, audit logs, and public repo secret hygiene.",
      ],
      acceptance: [
        "Findings are fixed or converted into explicitly prioritized follow-up issues.",
        "No known secret values are committed to the public repo.",
        "Approval and PR paths have no obvious bypass for protected operations.",
      ],
    }),
  },
  {
    title: "Agent evaluation framework",
    milestone: "M5 Agent Governance + Evals",
    labels: ["area:agents", "area:validation", "priority:p1"],
    body: issueBody({
      summary:
        "Create the evaluation layer that lets Loopworks change agent behavior deliberately.",
      deliverables: [
        "Scenario fixtures for planning, research, validation review, approval gates, and PR preparation.",
        "Regression checks for prompt, model, tool, and workflow changes.",
        "Policy that blocks risky loop or agent changes without eval evidence.",
      ],
      acceptance: [
        "At least one planning-agent eval fixture exists.",
        "Eval results can be attached to a loop change proposal.",
        "Docs explain how evals fit into loop governance and PR review.",
      ],
    }),
  },
];

const dryRun = process.argv.includes("--dry-run");

function issueBody(input: { summary: string; deliverables: string[]; acceptance: string[] }) {
  return [
    `## Summary\n${input.summary}`,
    `## Deliverables\n${input.deliverables.map((item) => `- ${item}`).join("\n")}`,
    `## Acceptance Criteria\n${input.acceptance.map((item) => `- ${item}`).join("\n")}`,
    "## Notes\nKeep GitHub as the durable planning surface. Add or update Loopworks docs, ADRs, persona test references, Storybook stories, Playwright coverage, and deterministic validation where this issue changes product behavior.",
  ].join("\n\n");
}

function runGh(args: string[], options: { allowFailure?: boolean } = {}) {
  if (dryRun) {
    process.stdout.write(`gh ${args.join(" ")}\n`);
    return "";
  }

  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim();
    if (options.allowFailure) {
      process.stderr.write(`Skipping failed command: gh ${args.join(" ")}\n${message}\n`);
      return "";
    }
    throw new Error(`gh ${args.join(" ")} failed:\n${message}`);
  }

  return result.stdout.trim();
}

function ensureLabels() {
  for (const label of labels) {
    runGh([
      "label",
      "create",
      label.name,
      "--repo",
      repository,
      "--color",
      label.color,
      "--description",
      label.description,
      "--force",
    ]);
  }
}

function existingMilestones() {
  const output = runGh(["api", `repos/${repository}/milestones?per_page=100`]);
  if (!output) {
    return new Map<string, ExistingMilestone>();
  }
  const parsed = JSON.parse(output) as ExistingMilestone[];
  return new Map(parsed.map((milestone) => [milestone.title, milestone]));
}

function ensureMilestones() {
  const existing = dryRun ? new Map<string, ExistingMilestone>() : existingMilestones();
  for (const milestone of milestones) {
    const existingMilestone = existing.get(milestone.title);
    if (existingMilestone) {
      if (existingMilestone.description !== milestone.description) {
        runGh([
          "api",
          "-X",
          "PATCH",
          `repos/${repository}/milestones/${existingMilestone.number}`,
          "-f",
          `description=${milestone.description}`,
        ]);
      }
      continue;
    }
    runGh([
      "api",
      `repos/${repository}/milestones`,
      "-f",
      `title=${milestone.title}`,
      "-f",
      `description=${milestone.description}`,
    ]);
  }
}

function existingIssues() {
  const output = runGh([
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,title,url,body,labels,milestone",
  ]);
  if (!output) {
    return new Map<string, ExistingIssue>();
  }
  const parsed = JSON.parse(output) as Array<{
    number: number;
    title: string;
    url: string;
    body: string;
    labels: Array<{ name: string }>;
    milestone?: { title: string } | null;
  }>;
  return new Map(
    parsed.map((issue) => [
      issue.title,
      {
        number: issue.number,
        url: issue.url,
        body: issue.body,
        labels: issue.labels.map((label) => label.name),
        milestone: issue.milestone?.title,
      },
    ]),
  );
}

function reconcileExistingIssue(issue: IssueSeed, existingIssue: ExistingIssue) {
  const currentLabels = new Set(existingIssue.labels);
  const desiredLabels = new Set(issue.labels);
  const labelsToAdd = issue.labels.filter((label) => !currentLabels.has(label));
  const labelsToRemove = existingIssue.labels.filter(
    (label) => managedLabelNames.has(label) && !desiredLabels.has(label),
  );

  const args = [
    "issue",
    "edit",
    String(existingIssue.number),
    "--repo",
    repository,
    "--body",
    issue.body,
  ];

  if (existingIssue.milestone !== issue.milestone) {
    args.push("--milestone", issue.milestone);
  }

  for (const label of labelsToAdd) {
    args.push("--add-label", label);
  }

  for (const label of labelsToRemove) {
    args.push("--remove-label", label);
  }

  if (
    existingIssue.body !== issue.body ||
    existingIssue.milestone !== issue.milestone ||
    labelsToAdd.length > 0 ||
    labelsToRemove.length > 0
  ) {
    runGh(args);
  }
}

function ensureIssues() {
  const existing = dryRun ? new Map<string, ExistingIssue>() : existingIssues();
  const createdOrExistingUrls: string[] = [];

  for (const issue of issues) {
    const existingIssue = existing.get(issue.title);
    if (existingIssue) {
      reconcileExistingIssue(issue, existingIssue);
      createdOrExistingUrls.push(existingIssue.url);
      continue;
    }

    const output = runGh([
      "issue",
      "create",
      "--repo",
      repository,
      "--title",
      issue.title,
      "--body",
      issue.body,
      "--milestone",
      issue.milestone,
      ...issue.labels.flatMap((label) => ["--label", label]),
    ]);

    if (output.startsWith("http")) {
      createdOrExistingUrls.push(output);
    }
  }

  return createdOrExistingUrls;
}

function ensureProject(issueUrls: string[]) {
  if (dryRun) {
    runGh(["project", "list", "--owner", owner, "--format", "json"]);
    runGh(["project", "create", "--owner", owner, "--title", projectTitle, "--format", "json"]);
    return;
  }

  const listOutput = runGh(["project", "list", "--owner", owner, "--format", "json"], {
    allowFailure: true,
  });
  let projectNumber: number | undefined;

  if (listOutput) {
    const parsed = JSON.parse(listOutput) as {
      projects?: Array<{ number: number; title: string }>;
    };
    projectNumber = parsed.projects?.find((project) => project.title === projectTitle)?.number;
  }

  if (!projectNumber) {
    const createOutput = runGh(
      ["project", "create", "--owner", owner, "--title", projectTitle, "--format", "json"],
      { allowFailure: true },
    );
    if (createOutput) {
      const parsed = JSON.parse(createOutput) as { number?: number };
      projectNumber = parsed.number;
    }
  }

  if (!projectNumber) {
    process.stderr.write(
      "Project v2 creation was skipped; gh project permissions may be missing.\n",
    );
    return;
  }

  for (const url of issueUrls) {
    runGh(["project", "item-add", String(projectNumber), "--owner", owner, "--url", url], {
      allowFailure: true,
    });
  }
}

function main() {
  process.stdout.write(`${dryRun ? "Dry run for" : "Bootstrapping"} ${repository}\n`);
  ensureLabels();
  ensureMilestones();
  const issueUrls = ensureIssues();
  ensureProject(issueUrls);
  process.stdout.write("GitHub bootstrap complete.\n");
}

main();
