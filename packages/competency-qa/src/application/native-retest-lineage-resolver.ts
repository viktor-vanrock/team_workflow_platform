import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { CompletedManualSessionReview } from "./review-manual-session.ts";

export class NativeQaSessionRetestLineageResolver {
  constructor(
    private readonly getCompleted: (
      scope: QaScope,
      sessionId: string,
    ) => Promise<CompletedManualSessionReview | undefined>,
  ) {}
  async resolve(scope: QaScope, sessionId: string) {
    const value = await this.getCompleted(scope, sessionId);
    if (
      !value ||
      value.session.state !== "COMPLETED" ||
      value.session.workspaceId !== scope.workspaceId ||
      value.session.projectId !== scope.projectId ||
      value.session.sessionId !== sessionId
    )
      throw new QaDomainError("QA_RETEST_NATIVE_SESSION_INVALID");
    const lineage = value.nativeRetestLineage;
    if (
      lineage.workspaceId !== scope.workspaceId ||
      lineage.projectId !== scope.projectId ||
      lineage.sessionId !== sessionId ||
      lineage.sessionReviewRef.id !== value.sessionReview.id ||
      lineage.sessionReviewRef.version !== value.sessionReview.version ||
      lineage.sessionReviewRef.contentHash !== value.sessionReview.contentHash ||
      lineage.manifestRevisionRef.id !== value.manifest.manifestRevisionId ||
      lineage.manifestRevisionRef.version !== value.manifest.revision ||
      lineage.manifestRevisionRef.contentHash !== value.manifest.contentHash
    )
      throw new QaDomainError("QA_RETEST_NATIVE_SESSION_STALE_REF");
    return value.nativeRetestLineage;
  }
}
