/** @vitest-environment node */
import { expectTypeOf } from "vitest";

import * as transitions from "@/lib/loops/transitions";
import {
  type ApplyDevelopmentLoopImplementationResultInput,
  type ApplyDevelopmentLoopTestWritingResultInput,
  type DevelopmentLoopTerminalReason,
  type DevelopmentLoopTerminalStatus,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
  type DevelopmentLoopTransitionMetrics,
  type DevelopmentLoopValidationTransitionStatus,
  type ExpectedValidationGate,
  type ImplementationTransitionResult,
  type PrPreparationTransitionResult,
  type RecordDevelopmentLoopPlanArtifactInput,
  type TestWritingTransitionResult,
  type ValidationReviewTransitionResult,
} from "@/lib/loops/transitions";
import * as finalizationTransitions from "@/lib/loops/transitions/finalization";
import * as implementationTransitions from "@/lib/loops/transitions/implementation";
import * as planTransitions from "@/lib/loops/transitions/plan";
import * as prPreparationTransitions from "@/lib/loops/transitions/pr-preparation";
import * as prStageTransitions from "@/lib/loops/transitions/pr-stage";
import { DevelopmentLoopTransitionError as SharedTransitionError } from "@/lib/loops/transitions/shared";
import * as testWritingTransitions from "@/lib/loops/transitions/test-writing";
import * as validationTransitions from "@/lib/loops/transitions/validation";
import * as validationReviewTransitions from "@/lib/loops/transitions/validation-review";

type PublicTypeContract = {
  applyImplementationInput: ApplyDevelopmentLoopImplementationResultInput;
  applyTestWritingInput: ApplyDevelopmentLoopTestWritingResultInput;
  database: DevelopmentLoopTransitionDatabase;
  expectedGate: ExpectedValidationGate;
  implementationResult: ImplementationTransitionResult;
  planInput: RecordDevelopmentLoopPlanArtifactInput;
  prPreparationResult: PrPreparationTransitionResult;
  terminalReason: DevelopmentLoopTerminalReason;
  terminalStatus: DevelopmentLoopTerminalStatus;
  testWritingResult: TestWritingTransitionResult;
  transitionMetrics: DevelopmentLoopTransitionMetrics;
  validationReviewResult: ValidationReviewTransitionResult;
  validationStatus: DevelopmentLoopValidationTransitionStatus;
};

describe("development-loop transition public exports", () => {
  it("exports the complete auditable runtime surface", () => {
    expect(Object.keys(transitions).sort()).toEqual([
      "DevelopmentLoopTransitionError",
      "applyDevelopmentLoopImplementationResult",
      "applyDevelopmentLoopPrPreparationResult",
      "applyDevelopmentLoopTestWritingResult",
      "applyDevelopmentLoopValidationReport",
      "applyDevelopmentLoopValidationReviewResult",
      "completeDevelopmentLoopRun",
      "executeDevelopmentLoopPrStage",
      "finalizeDevelopmentLoopRun",
      "recordDevelopmentLoopPlanArtifact",
      "retryDevelopmentLoopStep",
      "scheduleDevelopmentLoopStageRetry",
    ]);
  });

  it("preserves one DevelopmentLoopTransitionError runtime identity", () => {
    expect(DevelopmentLoopTransitionError).toBe(SharedTransitionError);
    expect(new transitions.DevelopmentLoopTransitionError("transition_failed")).toBeInstanceOf(
      SharedTransitionError,
    );
  });

  it("re-exports each owning module function without a wrapper or miswire", () => {
    expect(transitions.recordDevelopmentLoopPlanArtifact).toBe(
      planTransitions.recordDevelopmentLoopPlanArtifact,
    );
    expect(transitions.applyDevelopmentLoopTestWritingResult).toBe(
      testWritingTransitions.applyDevelopmentLoopTestWritingResult,
    );
    expect(transitions.applyDevelopmentLoopImplementationResult).toBe(
      implementationTransitions.applyDevelopmentLoopImplementationResult,
    );
    expect(transitions.applyDevelopmentLoopValidationReport).toBe(
      validationTransitions.applyDevelopmentLoopValidationReport,
    );
    expect(transitions.applyDevelopmentLoopPrPreparationResult).toBe(
      prPreparationTransitions.applyDevelopmentLoopPrPreparationResult,
    );
    expect(transitions.applyDevelopmentLoopValidationReviewResult).toBe(
      validationReviewTransitions.applyDevelopmentLoopValidationReviewResult,
    );
    expect(transitions.executeDevelopmentLoopPrStage).toBe(
      prStageTransitions.executeDevelopmentLoopPrStage,
    );
    expect(transitions.finalizeDevelopmentLoopRun).toBe(
      finalizationTransitions.finalizeDevelopmentLoopRun,
    );
    expect(transitions.completeDevelopmentLoopRun).toBe(
      finalizationTransitions.completeDevelopmentLoopRun,
    );
    expect(transitions.scheduleDevelopmentLoopStageRetry).toBe(
      finalizationTransitions.scheduleDevelopmentLoopStageRetry,
    );
    expect(transitions.retryDevelopmentLoopStep).toBe(
      finalizationTransitions.retryDevelopmentLoopStep,
    );
  });

  it("preserves every exported transition contract type", () => {
    expectTypeOf<PublicTypeContract>().toBeObject();
  });
});
