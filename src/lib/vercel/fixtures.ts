import type { VercelDeploymentPayload } from "./types";

export const vercelDeploymentFixtures: VercelDeploymentPayload[] = [
  {
    uid: "dpl_fixture_preview_1",
    name: "loopworks",
    projectId: "prj_loopworks",
    url: "loopworks-git-issue-42-loopworks.vercel.app",
    state: "READY",
    readyState: "READY",
    createdAt: Date.parse("2026-06-18T18:05:00.000Z"),
    ready: Date.parse("2026-06-18T18:07:12.000Z"),
    target: "preview",
    alias: ["loopworks-preview-42.vercel.app"],
    inspectorUrl: "https://vercel.com/ncolesummers/loopworks/preview/42",
    creator: {
      username: "eve-agent",
    },
    gitSource: {
      type: "github",
      ref: "issue-42-vercel-preview",
      sha: "abc1234567890def",
      repo: "loopworks",
      org: "ncolesummers",
      prId: 19,
    },
    meta: {
      githubCommitRef: "issue-42-vercel-preview",
      githubCommitSha: "abc1234567890def",
      githubPullRequestId: "19",
      loopworksIssue: "42",
    },
  },
  {
    uid: "dpl_fixture_prod_1",
    name: "loopworks",
    projectId: "prj_loopworks",
    url: "loopworks.vercel.app",
    state: "BUILDING",
    readyState: "BUILDING",
    createdAt: Date.parse("2026-06-18T20:10:00.000Z"),
    target: "production",
    alias: ["loopworks.vercel.app"],
    creator: {
      username: "ncolesummers",
    },
    gitSource: {
      type: "github",
      ref: "main",
      sha: "fedcba0987654321",
      repo: "loopworks",
      org: "ncolesummers",
    },
    meta: {
      githubCommitRef: "main",
      githubCommitSha: "fedcba0987654321",
    },
  },
];
