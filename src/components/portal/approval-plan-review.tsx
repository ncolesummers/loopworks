// biome-ignore-all lint/suspicious/noArrayIndexKey: The bound artifact is immutable; ordinal keys distinguish repeated read-only plan entries.
import { getSafeExternalHref } from "@/components/portal/safe-url";
import type { ApprovalGateRecord } from "@/lib/types";

const disclosureClass =
  "cursor-pointer rounded-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Read-only projection; approval writes remain owned by ApprovalDecision. */
export function ApprovalPlanReview({ plan }: { plan: ApprovalGateRecord["plan"] }) {
  const review = plan?.review;
  const href = getSafeExternalHref(review?.issue.url);
  return (
    <section
      aria-label="Plan under review"
      className="min-w-0 space-y-6 text-sm [overflow-wrap:break-word]"
    >
      <section className="space-y-2">
        <h3 className="font-semibold">What approval permits</h3>
        <p>
          Approval records your decision for this plan and allows the run to proceed to test
          writing. Later stages retain their existing validation and approval requirements.
        </p>
      </section>
      {plan?.reviewability !== "ready" && (
        <p className="rounded-md border p-3">
          Plan content cannot be reviewed for approval.{" "}
          {plan?.reason ?? "A complete, supported plan bound to this gate is required."}{" "}
          Confirmation is unavailable.{" "}
          {plan?.canReject
            ? "You can reject this request."
            : "Rejection is also unavailable because the request lacks the plan or run identity required by the transition route."}
        </p>
      )}
      {review && (
        <>
          <section className="space-y-2">
            <h3 className="font-semibold">Repository and issue</h3>
            <p>
              {review.issue.repositoryFullName} · Issue #{review.issue.number}
            </p>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {review.issue.title}
              </a>
            ) : (
              <p>{review.issue.title}</p>
            )}
          </section>
          <section className="max-w-prose space-y-2">
            <h3 className="font-semibold">Summary</h3>
            <p>{review.summary}</p>
          </section>
          <section className="space-y-3">
            <h3 className="font-semibold">Proposed steps</h3>
            <ol className="list-decimal space-y-4 pl-5">
              {review.steps.map((step, index) => (
                <li key={`${index}-${step.title}`} className="space-y-1 pl-1">
                  <h4 className="font-medium">{step.title}</h4>
                  <p className="max-w-prose">{step.outcome}</p>
                  <p className="text-xs text-muted-foreground">
                    Owner: {step.owner} ·{" "}
                    {step.requiresApproval
                      ? "Approval required"
                      : "No additional step approval specified"}
                  </p>
                </li>
              ))}
            </ol>
          </section>
          <section className="space-y-3">
            <h3 className="font-semibold">Planned validation</h3>
            <p className="text-muted-foreground">
              These are proposed checks and expected evidence, not completed verification results.
            </p>
            <ul className="space-y-4">
              {review.validationGates.map((gate, index) => (
                <li key={`${index}-${gate.key}`} className="space-y-1">
                  <h4 className="font-medium">{gate.name}</h4>
                  <code className="block whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
                    {gate.command}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    {gate.phase.replaceAll("_", " ")} · {gate.required ? "Required" : "Optional"}
                  </p>
                  <p>{gate.evidence}</p>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <h3 className="font-semibold">Risks and mitigations</h3>
            <ul className="space-y-4">
              {review.risks.map((risk, index) => (
                <li key={`${index}-${risk.key}`} className="space-y-1">
                  <p className="font-medium">{risk.description}</p>
                  <p className="text-xs text-muted-foreground">Severity: {risk.severity}</p>
                  <p>{risk.mitigation}</p>
                </li>
              ))}
            </ul>
          </section>
          <details className="space-y-4 border-t pt-4">
            <summary className={disclosureClass}>Additional plan context</summary>
            <section className="space-y-2">
              <h3 className="font-semibold">Acceptance criteria</h3>
              {review.issue.acceptanceCriteria.length ? (
                <ul className="list-disc space-y-2 pl-5">
                  {review.issue.acceptanceCriteria.map((criterion, index) => (
                    <li key={`${index}-${criterion}`}>{criterion}</li>
                  ))}
                </ul>
              ) : (
                <p>No acceptance criteria recorded.</p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Stages</h3>
              <ol className="list-decimal space-y-3 pl-5">
                {review.stages.map((stage, index) => (
                  <li key={`${index}-${stage.key}`}>
                    <h4 className="font-medium">{stage.title}</h4>
                    <p>{stage.outcome}</p>
                    <p className="text-xs text-muted-foreground">
                      Planned validation gates:{" "}
                      {stage.validationGateKeys.length
                        ? stage.validationGateKeys.join(", ")
                        : "None specified"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Owner: {stage.owner} ·{" "}
                      {stage.approvalRequired ? "Approval required" : "No stage approval specified"}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Checkpoints</h3>
              <ul className="list-disc space-y-2 pl-5">
                {review.checkpoints.map((checkpoint, index) => (
                  <li key={`${index}-${checkpoint}`}>{checkpoint}</li>
                ))}
              </ul>
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Approval points</h3>
              <ul className="space-y-3">
                {review.approvalPoints.map((point, index) => (
                  <li key={`${index}-${point.key}`}>
                    <p>{point.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Reviewer: {point.reviewer} · {point.required ? "Required" : "Optional"}
                    </p>
                    <ul className="list-disc pl-5">
                      {point.evidence.map((evidence, i) => (
                        <li key={`${i}-${evidence}`}>{evidence}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-muted-foreground">
              Evaluation coverage, tool boundaries, and all additional artifact fields remain
              available in the complete raw content below.
            </p>
          </details>
        </>
      )}
      <details className="space-y-3 border-t pt-4">
        <summary className={disclosureClass}>Technical details</summary>
        <p className="[overflow-wrap:anywhere]">Plan {plan?.id ?? "identity unavailable"}</p>
        <p className="font-mono text-xs [overflow-wrap:anywhere]">
          SHA256 {plan?.sha256 ?? "unavailable"}
        </p>
        {review?.repositoryRevision && (
          <p className="text-xs [overflow-wrap:anywhere]">
            Repository revision: {review.repositoryRevision.ref} ·{" "}
            {review.repositoryRevision.commitSha}
          </p>
        )}
        {plan?.content ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
            {plan.content}
          </pre>
        ) : (
          <p>Raw plan content is unavailable.</p>
        )}
      </details>
    </section>
  );
}
