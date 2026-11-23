import type { QaEvidenceManifestRevision } from "../domain/evidence-manifest.ts";
import type { QaManualAttempt } from "../domain/manual-attempt.ts";
import type { QaObservation } from "../domain/observation.ts";
import type { QaPlanItemResultRevision } from "../domain/plan-item-result.ts";
import type { QaScope } from "../domain/primitives.ts";
import type { QaSessionReview } from "../domain/session-review.ts";
import type { QaEvidenceArtifactLink } from "./evidence-artifact-service.ts";
import type {
  QaWorkItemDetailReadContext,
  QaWorkItemDetailSectionContribution,
} from "./qa-work-item-detail.ts";

export interface QaExecutionEvidenceDetailReadPort {
  attempts(scope: QaScope, workItemId: string): Promise<readonly QaManualAttempt[]>;
  observations(scope: QaScope, workItemId: string): Promise<readonly QaObservation[]>;
  resultRevisions(scope: QaScope, workItemId: string): Promise<readonly QaPlanItemResultRevision[]>;
  evidenceLinks(scope: QaScope, workItemId: string): Promise<readonly QaEvidenceArtifactLink[]>;
  manifestRevisions(
    scope: QaScope,
    workItemId: string,
  ): Promise<readonly QaEvidenceManifestRevision[]>;
  sessionReviews(scope: QaScope, workItemId: string): Promise<readonly QaSessionReview[]>;
}

export function createQaExecutionEvidenceDetailSection(
  port: QaExecutionEvidenceDetailReadPort,
): QaWorkItemDetailSectionContribution {
  return Object.freeze({
    key: "qa.execution-evidence",
    order: 400,
    load: async ({ workspaceId, projectId, workItemId }: QaWorkItemDetailReadContext) => {
      const scope = { workspaceId, projectId };
      const [
        manualAttempts,
        observations,
        planItemResultRevisions,
        evidenceArtifactLinks,
        evidenceManifestHistories,
        sessionReviews,
      ] = await Promise.all([
        port.attempts(scope, workItemId),
        port.observations(scope, workItemId),
        port.resultRevisions(scope, workItemId),
        port.evidenceLinks(scope, workItemId),
        port.manifestRevisions(scope, workItemId),
        port.sessionReviews(scope, workItemId),
      ]);
      return Object.freeze({
        manualAttempts,
        observations,
        planItemResultRevisions,
        evidenceArtifactLinks,
        evidenceManifestHistories,
        sessionReviews,
      });
    },
  });
}
