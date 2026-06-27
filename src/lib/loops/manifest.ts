import {
  type LoopManifest,
  type LoopState,
  loopManifestSchema,
  loopStateValues,
} from "../../../schemas/loop-manifest";

export const defaultLoopManifest: LoopManifest = loopManifestSchema.parse({
  repo: "ncolesummers/loopworks",
  note: "Loopworks operating contract and bootstrap planning manifest.",
  milestones: [
    {
      key: "M0",
      name: "M0 Project Foundation",
      description: "Repo and local development baseline.",
      personaTestIds: ["P01", "P03", "R02", "S04"],
      issues: [
        {
          title: "Project foundation and repo contract",
          labels: ["kind:epic", "milestone:M0", "area:docs"],
          template: "epic.yml",
          personaTestIds: ["P03", "R02"],
        },
        {
          title: "Bootstrap app shell and local development",
          labels: ["kind:task", "milestone:M0", "area:app-shell"],
          template: "task.yml",
          personaTestIds: ["P01", "R02", "S04"],
        },
      ],
    },
    {
      key: "M1",
      name: "M1 Design System Direction + App Shell",
      description: "Early design direction and reusable shell primitives.",
      personaTestIds: ["P01", "P04", "M01", "A02", "R02"],
      issues: [
        {
          title: "Design system direction and tokens",
          labels: ["kind:design", "milestone:M1", "area:design-system"],
          template: "design-system.yml",
          personaTestIds: ["P04", "R02"],
        },
        {
          title: "App shell navigation and layout",
          labels: ["kind:task", "milestone:M1", "area:app-shell"],
          template: "task.yml",
          personaTestIds: ["P01", "P04", "M01", "A02"],
        },
      ],
    },
    {
      key: "M2",
      name: "M2 GitHub + Vercel Source Systems",
      description: "Connect the external sources of truth.",
      personaTestIds: ["P02", "M01", "M03", "R01", "S01", "S02", "S03"],
      issues: [
        {
          title: "GitHub issue ingestion and sync",
          labels: ["kind:feature", "milestone:M2", "area:github", "status:ready"],
          template: "feature.yml",
          personaTestIds: ["P02", "S01", "S02", "S03"],
        },
        {
          title: "Vercel deployment and preview summaries",
          labels: ["kind:feature", "milestone:M2", "area:vercel", "status:ready"],
          template: "feature.yml",
          personaTestIds: ["M01", "M03", "R01"],
        },
      ],
    },
    {
      key: "M3",
      name: "M3 Durable Loop MVP",
      description: "Persisted loop model and timeline.",
      personaTestIds: ["M02", "A01", "A02", "A03", "R01"],
      issues: [
        {
          title: "Durable loop event model",
          labels: ["kind:feature", "milestone:M3", "area:loop"],
          template: "feature.yml",
          personaTestIds: ["M02", "A01", "A03"],
        },
        {
          title: "Loop timeline and status transitions",
          labels: ["kind:feature", "milestone:M3", "area:loop"],
          template: "feature.yml",
          personaTestIds: ["A01", "A02", "R01"],
        },
      ],
    },
    {
      key: "M4",
      name: "M4 Validation + PR Path + MVP Security Review",
      description: "Release confidence and security gate.",
      personaTestIds: ["A03", "R01", "R02", "S01", "S02", "S03", "S04"],
      issues: [
        {
          title: "Validation and PR checkpoint views",
          labels: ["kind:feature", "milestone:M4", "area:pr-flow"],
          template: "feature.yml",
          personaTestIds: ["A03", "R01", "R02"],
        },
        {
          title: "MVP security review",
          labels: ["kind:security", "milestone:M4", "priority:p0"],
          template: "security-review.yml",
          personaTestIds: ["S01", "S02", "S03", "S04"],
        },
      ],
    },
    {
      key: "M5",
      name: "M5 Agent Governance + Evals",
      description: "Policy, approvals, and eval coverage.",
      personaTestIds: ["P03", "A02", "A03", "R02", "S04"],
      issues: [
        {
          title: "Agent governance rules and approval boundaries",
          labels: ["kind:feature", "milestone:M5", "area:agent"],
          template: "feature.yml",
          personaTestIds: ["P03", "A02", "S04"],
        },
        {
          title: "Agent eval harness and scenario coverage",
          labels: ["kind:feature", "milestone:M5", "area:evals"],
          template: "feature.yml",
          personaTestIds: ["A03", "R02"],
        },
      ],
    },
  ],
  labels: [
    { name: "kind:epic", category: "kind" },
    { name: "kind:feature", category: "kind" },
    { name: "kind:task", category: "kind" },
    { name: "kind:bug", category: "kind" },
    { name: "kind:design", category: "kind" },
    { name: "kind:security", category: "kind" },
    { name: "priority:p0", category: "priority", required: true },
    { name: "priority:p1", category: "priority", required: true },
    { name: "priority:p2", category: "priority", required: true },
    { name: "priority:p3", category: "priority", required: true },
    { name: "area:docs", category: "area", required: true },
    { name: "area:app-shell", category: "area", required: true },
    { name: "area:design-system", category: "area", required: true },
    { name: "area:github", category: "area", required: true },
    { name: "area:vercel", category: "area", required: true },
    { name: "area:loop", category: "area", required: true },
    { name: "area:pr-flow", category: "area", required: true },
    { name: "area:agent", category: "area", required: true },
    { name: "area:evals", category: "area", required: true },
    { name: "status:blocked", category: "status" },
    { name: "status:ready", category: "status" },
    { name: "status:in-progress", category: "status" },
    { name: "status:review", category: "status" },
  ],
});

export function parseLoopManifest(input: unknown): LoopManifest {
  return loopManifestSchema.parse(input);
}

export function isLoopState(value: string): value is LoopState {
  return loopStateValues.includes(value as LoopState);
}
