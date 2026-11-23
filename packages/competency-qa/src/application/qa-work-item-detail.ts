import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaRequestExtension } from "../domain/qa-request.ts";
import type { QaRequestInputRevision } from "../domain/qa-request-input-revision.ts";

export interface QaWorkItemDetailReadContext extends QaScope {
  readonly workItemId: string;
}

export interface QaWorkItemDetailSectionContribution {
  readonly key: string;
  readonly order: number;
  load(context: QaWorkItemDetailReadContext): Promise<Readonly<Record<string, unknown>>>;
}

export class QaWorkItemDetailSectionRegistry {
  readonly #contributions: readonly QaWorkItemDetailSectionContribution[];
  constructor(contributions: readonly QaWorkItemDetailSectionContribution[]) {
    const keys = new Set<string>();
    for (const contribution of contributions) {
      if (keys.has(contribution.key)) throw new QaDomainError("QA_DETAIL_SECTION_COLLISION");
      keys.add(contribution.key);
    }
    this.#contributions = Object.freeze(
      [...contributions].sort(
        (left, right) => left.order - right.order || left.key.localeCompare(right.key),
      ),
    );
  }

  async detail(context: QaWorkItemDetailReadContext): Promise<Readonly<Record<string, unknown>>> {
    const output: Record<string, unknown> = {
      schemaVersion: 1,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      workItemId: context.workItemId,
      requestExtension: null,
      requestInputHistory: null,
      operationalReadiness: Object.freeze({
        assessmentRef: null,
        assessmentState: "NOT_EVALUATED",
        normalizedStatus: "NEW",
        syncStage: "NOT_EVALUATED",
      }),
      readinessAssessments: [],
      waivers: [],
      requiredSessionPlanHistory: null,
      sessions: [],
      sessionReviews: [],
      planItems: [],
      manualAttempts: [],
      observations: [],
      planItemResultRevisions: [],
      evidenceArtifactLinks: [],
      evidenceManifestHistories: [],
      postCloseCorrectionMarkers: [],
      findings: [],
      findingReviewRevisions: [],
      defectDrafts: [],
      defectLinks: [],
      verdicts: [],
      verdictSignatures: [],
      dodAssessments: [],
      completionCandidates: [],
      finalCloseConfirmations: [],
    };
    for (const contribution of this.#contributions) {
      const section = await contribution.load(context);
      for (const [key, value] of Object.entries(section)) {
        if (
          key in output &&
          output[key] !== null &&
          !(Array.isArray(output[key]) && (output[key] as unknown[]).length === 0) &&
          key !== "operationalReadiness"
        ) {
          throw new QaDomainError("QA_DETAIL_FIELD_COLLISION");
        }
        output[key] = value;
      }
    }
    if (output.requestExtension === null || output.requestInputHistory === null)
      throw new QaDomainError("QA_REQUEST_DETAIL_NOT_FOUND");
    return Object.freeze(output);
  }
}

export interface QaConfirmedBacklogItem {
  readonly requestExtension: QaRequestExtension;
  readonly currentRequestInputRevision: QaRequestInputRevision;
  readonly operationalReadiness: Readonly<{
    assessmentRef: null;
    assessmentState: "NOT_EVALUATED";
    normalizedStatus: "NEW";
    syncStage: "NOT_EVALUATED";
  }>;
}

export interface QaConfirmedBacklogReadPort {
  extensions(scope: QaScope): Promise<readonly QaRequestExtension[]>;
  input(
    scope: QaScope,
    workItemId: string,
    version: number,
  ): Promise<QaRequestInputRevision | undefined>;
}

const notEvaluated = Object.freeze({
  assessmentRef: null,
  assessmentState: "NOT_EVALUATED" as const,
  normalizedStatus: "NEW" as const,
  syncStage: "NOT_EVALUATED" as const,
});

export async function listConfirmedQaBacklog(
  port: QaConfirmedBacklogReadPort,
  scope: QaScope,
): Promise<readonly QaConfirmedBacklogItem[]> {
  const extensions = await port.extensions(scope);
  const items = await Promise.all(
    extensions.map(async (extension) => {
      const current = await port.input(
        scope,
        extension.workItemId,
        extension.currentRequestInputRevisionRef.version,
      );
      if (!current || current.contentHash !== extension.currentRequestInputRevisionRef.contentHash)
        throw new QaDomainError("QA_CURRENT_INPUT_POINTER_INVALID");
      return Object.freeze({
        requestExtension: extension,
        currentRequestInputRevision: current,
        operationalReadiness: notEvaluated,
      });
    }),
  );
  return Object.freeze(items);
}
