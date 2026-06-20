import { LoopRegistry } from "@/components/portal/dashboard-view";

export default function LoopsPage() {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Loops</h1>
      <h2 className="sr-only">Loop controls</h2>
      <LoopRegistry />
    </div>
  );
}
