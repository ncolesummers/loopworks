import type { InferSelectModel } from "drizzle-orm";

import type { loops, repositories, vercelProjects } from "@/db/schema";
import type { RepoRecord } from "@/lib/types";

type RepositoryRow = InferSelectModel<typeof repositories>;
type LoopRow = Pick<
  InferSelectModel<typeof loops>,
  "areaLabel" | "githubIssueNumber" | "milestone" | "priorityLabel"
>;
type VercelProjectRow = Pick<
  InferSelectModel<typeof vercelProjects>,
  "dashboardUrl" | "productionUrl" | "projectId"
>;

interface RepoRecordProjection {
  repository: RepositoryRow;
  loops: LoopRow[];
  vercelProject?: VercelProjectRow | null;
  now?: Date;
}

function stripLabelPrefix(value: string | null | undefined, prefix: string, fallback: string) {
  if (!value) {
    return fallback;
  }

  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function formatLastSynced(lastSyncedAt: Date | null, now: Date) {
  if (!lastSyncedAt) {
    return "Not synced";
  }

  const elapsedMs = Math.max(0, now.getTime() - lastSyncedAt.getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);

  if (elapsedMinutes < 1) {
    return "just now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function getStaleDays(lastSyncedAt: Date | null, now: Date) {
  if (!lastSyncedAt) {
    return 0;
  }

  const elapsedMs = Math.max(0, now.getTime() - lastSyncedAt.getTime());
  return Math.floor(elapsedMs / 86_400_000);
}

export function createRepoRecordFromProjection({
  repository,
  loops: loopRows,
  vercelProject,
  now = new Date(),
}: RepoRecordProjection): RepoRecord {
  const primaryLoop = [...loopRows].sort(
    (left, right) => left.githubIssueNumber - right.githubIssueNumber,
  )[0];

  return {
    name: repository.name,
    owner: repository.owner,
    description: `Catalog projection for ${repository.fullName}.`,
    health: repository.health,
    githubHref: `https://github.com/${repository.fullName}`,
    framework: repository.framework,
    defaultBranch: repository.defaultBranch,
    ciCommands: repository.ciCommands,
    docsHref: repository.docsHref ?? undefined,
    observabilityHref: repository.observabilityHref ?? undefined,
    designSystemHref: repository.designSystemHref ?? undefined,
    enabledLoops: repository.enabledLoops,
    validationGates: repository.validationGates,
    vercelProjectId: vercelProject?.projectId,
    vercelProjectHref: vercelProject?.dashboardUrl ?? vercelProject?.productionUrl ?? undefined,
    milestone: primaryLoop?.milestone ?? "Unassigned",
    area: stripLabelPrefix(primaryLoop?.areaLabel, "area:", "unmapped"),
    priority: stripLabelPrefix(primaryLoop?.priorityLabel, "priority:", "unprioritized"),
    openIssues: loopRows.length,
    staleDays: getStaleDays(repository.lastSyncedAt, now),
    lastSynced: formatLastSynced(repository.lastSyncedAt, now),
  };
}
