import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { portalFixture } from "@/lib/fixtures";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Approvals</h1>
      <h2 className="sr-only">Approval state</h2>
      <ApprovalGatePanel approval={portalFixture.approval} />
    </div>
  );
}
