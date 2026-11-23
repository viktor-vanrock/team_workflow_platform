import { type QaContentHash, QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import type { QaExternalImmutableRef } from "../domain/qa-project-context.ts";
import {
  publishRequiredSessionPlan,
  type QaPlanOperationalStatus,
  type QaRequiredSessionPlanHeader,
  type QaRequiredSessionPlanRequirement,
  type QaRequiredSessionRequirementInput,
} from "../domain/required-session-plan.ts";

export interface QaRequiredSessionPlanStore {
  current(workItemId: string): Promise<QaRequiredSessionPlanHeader | undefined>;
  compareAndSet(
    expectedResourceVersion: number,
    next: QaRequiredSessionPlanHeader,
  ): Promise<boolean>;
}

export class QaRequiredSessionPlanner {
  constructor(private readonly store: QaRequiredSessionPlanStore) {}

  async publish(
    input: Readonly<{
      workItemId: string;
      expectedResourceVersion: number;
      readiness: {
        confirmed: boolean;
        proofRef: { id: string; version: number; contentHash: QaContentHash };
      };
      operationalStatus: QaPlanOperationalStatus;
      requirements: readonly QaRequiredSessionRequirementInput[];
      catalogs: {
        target: readonly QaExternalImmutableRef[];
        scope: readonly QaExternalImmutableRef[];
        checklist: readonly QaExternalImmutableRef[];
      };
      actor: QaHumanActor;
      reason: string;
      publishedAt: string;
      revisionId: string;
    }>,
  ) {
    const header = await this.store.current(input.workItemId);
    if (!header) throw new QaDomainError("QA_PLAN_HEADER_NOT_FOUND");
    const published = publishRequiredSessionPlan({ ...input, header });
    if (!(await this.store.compareAndSet(input.expectedResourceVersion, published.header)))
      throw new QaDomainError("QA_PLAN_STALE_VERSION");
    return published;
  }

  coverageRequirement(
    header: QaRequiredSessionPlanHeader,
    requirementKey: string,
  ): QaRequiredSessionPlanRequirement {
    const current = header.revisions
      .at(-1)
      ?.requirements.find((requirement) => requirement.requirementKey === requirementKey);
    if (!current) throw new QaDomainError("QA_PLAN_REQUIREMENT_NOT_FOUND");
    return current;
  }
}
