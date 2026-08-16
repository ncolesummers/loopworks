import {
  logGithubRepositorySelectionAuthorization,
  type RepositorySelectionAuthorizationObservation,
} from "@/lib/observability/logger";
import { recordGithubRepositorySelectionAuthorizationMetric } from "@/lib/observability/metrics";
import { markGithubRepositorySelectionAuthorizationSpanOutcome } from "@/lib/observability/trace-context";

export function observeGithubRepositorySelectionAuthorization(
  observation: RepositorySelectionAuthorizationObservation,
): void {
  logGithubRepositorySelectionAuthorization(observation);
  recordGithubRepositorySelectionAuthorizationMetric(observation);
  markGithubRepositorySelectionAuthorizationSpanOutcome(observation);
}
