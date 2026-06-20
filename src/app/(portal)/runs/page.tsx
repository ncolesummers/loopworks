import { TimelineAndArtifacts } from "@/components/portal/dashboard-view";

export default function RunsPage() {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Runs</h1>
      <h2 className="sr-only">Run history</h2>
      <TimelineAndArtifacts />
    </div>
  );
}
