import type { JsonValue } from "@awp/platform-contracts";

import type { QaDefectDraftAggregate } from "../domain/defect-publication.ts";
import { QaDomainError, type QaWorkspaceContext } from "../domain/primitives.ts";

export interface ApprovedDefectIntentInput {
  readonly defectDraftId: string;
  readonly version: number;
  readonly findingRef: Readonly<{ id: string; version: string; contentHash: string }>;
  readonly sessionRef: Readonly<{ id: string; version: string; contentHash: string }>;
  readonly buildRef: Readonly<{ id: string; version: string; contentHash: string }>;
  readonly evidenceRefs: readonly Readonly<{ id: string; version: string; contentHash: string }>[];
  readonly title: string;
  readonly description: string;
}
export function createApprovedDefectIntent(input: ApprovedDefectIntentInput) {
  if (input.version < 1 || input.evidenceRefs.length === 0)
    throw new QaDomainError("QA_DEFECT_INTENT_EVIDENCE_REQUIRED");
  return Object.freeze({
    operation: "defect.create" as const,
    logicalRole: "DEFECT_DESTINATION" as const,
    auxiliaryRoles: Object.freeze(["QA_REQUEST_AUTHORITY"] as const),
    clientRequestKey: `qa:defect:${input.defectDraftId}:${input.version}`,
    payload: Object.freeze({
      summary: input.title,
      description: input.description,
      findingRef: input.findingRef,
      sessionRef: input.sessionRef,
      buildRef: input.buildRef,
      evidenceRefs: Object.freeze([...input.evidenceRefs]),
    }),
    approvalRequired: true as const,
  });
}

export interface DefectPublicationApproval {
  readonly approvalId: string;
  readonly initiatorId: string;
  readonly subjectHash: string;
  readonly expiresAt: string;
  readonly state: "PENDING" | "APPROVED" | "CONSUMED";
  readonly approverId?: string;
}
export class DefectPublicationApprovalPolicy {
  readonly #consumed = new Set<string>();
  request(input: Omit<DefectPublicationApproval, "state">): DefectPublicationApproval {
    return Object.freeze({ ...input, state: "PENDING" });
  }
  approve(
    approval: DefectPublicationApproval,
    input: Readonly<{ actorId: string; role: string; now: string }>,
  ): DefectPublicationApproval {
    if (approval.state !== "PENDING") throw new QaDomainError("QA_DEFECT_APPROVAL_ALREADY_DECIDED");
    if (input.actorId === approval.initiatorId) throw new QaDomainError("SELF_APPROVAL_FORBIDDEN");
    if (
      ![
        "system-administrator",
        "workspace-owner",
        "integration-administrator",
        "integration-admin",
      ].includes(input.role.toLowerCase().replaceAll("_", "-")) ||
      Date.parse(input.now) >= Date.parse(approval.expiresAt)
    )
      throw new QaDomainError("QA_DEFECT_APPROVER_UNAUTHORIZED");
    return Object.freeze({ ...approval, state: "APPROVED", approverId: input.actorId });
  }
  consume(approval: DefectPublicationApproval, subjectHash: string): DefectPublicationApproval {
    if (
      approval.state !== "APPROVED" ||
      approval.subjectHash !== subjectHash ||
      this.#consumed.has(approval.approvalId)
    )
      throw new QaDomainError("QA_DEFECT_APPROVAL_NOT_CONSUMABLE");
    this.#consumed.add(approval.approvalId);
    return Object.freeze({ ...approval, state: "CONSUMED" });
  }
}

export interface QaDefectCommandSubmission {
  readonly replayed: boolean;
  readonly command: Readonly<{
    id: string;
    approvalId?: string;
    effectIdempotencyKey: string;
    status: string;
  }>;
}
export interface QaDefectCommandGatewayPort {
  submit(
    context: QaWorkspaceContext,
    intent: Readonly<{
      clientRequestKey: string;
      commandType: string;
      capability: Readonly<{
        key: string;
        exactContractVersion: string;
        operation: string;
        logicalRole: string;
      }>;
      target: JsonValue;
      payload: JsonValue;
      expectedExternalState: JsonValue;
      bindingRef: Readonly<{ id: string; version: number }>;
      profileRef: Readonly<{ id: string; version: number }>;
      dataClassificationKey: string;
      source: Readonly<{ sourceWorkItemId: string }>;
      approvalRequired: true;
    }>,
  ): Promise<QaDefectCommandSubmission>;
}

export async function publishQaDefectDraft(
  input: Readonly<{
    context: QaWorkspaceContext;
    draft: QaDefectDraftAggregate;
    authorityScopeKey: string;
    dataClassificationKey: string;
    bindingRef: Readonly<{ id: string; version: number }>;
    profileRef: Readonly<{ id: string; version: number }>;
    commandGateway: QaDefectCommandGatewayPort;
    at: string;
  }>,
) {
  if (input.context.actor.kind !== "HUMAN") throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  if (input.draft.state !== "READY_FOR_APPROVAL" || !input.draft.evidenceRefs.length)
    throw new QaDomainError("QA_DEFECT_DRAFT_NOT_READY");
  const profile = input.profileRef;
  if (profile.version < 3) throw new QaDomainError("QA_DEFECT_PROFILE_OPERATION_UNAVAILABLE");
  const target = {
    workspaceId: input.draft.workspaceId,
    projectId: input.draft.projectId,
    entityKind: "DEFECT",
    authorityScopeKey: input.authorityScopeKey,
    naturalKey: input.draft.findingId,
  } as unknown as JsonValue;
  const payload = {
    sourceWorkItemId: input.draft.workItemId,
    summary: input.draft.title,
    description: input.draft.description,
    dataClassificationKey: input.dataClassificationKey,
    sourceRefs: [
      {
        kind: "QA_FINDING_REVIEW",
        id: input.draft.frozenFindingReviewRef.id,
        version: String(input.draft.frozenFindingReviewRef.version),
        contentHash: input.draft.frozenFindingReviewRef.contentHash,
      },
      ...input.draft.evidenceRefs.map((ref) => ({ kind: "ARTIFACT", ...ref })),
    ],
  } as unknown as JsonValue;
  const submitted = await input.commandGateway.submit(input.context, {
    clientRequestKey: `qa:defect:${input.draft.defectDraftId}:${input.draft.version}`,
    commandType: "qa.defect.create",
    capability: {
      key: "operational-work-item",
      exactContractVersion: "1.0.0",
      operation: "defect.create",
      logicalRole: "QA_DEFECT",
    },
    target,
    payload,
    expectedExternalState: { normalizedStatus: "ABSENT" },
    bindingRef: input.bindingRef,
    profileRef: profile,
    dataClassificationKey: input.dataClassificationKey,
    source: { sourceWorkItemId: input.draft.workItemId },
    approvalRequired: true,
  });
  if (!submitted.command.approvalId) throw new QaDomainError("QA_DEFECT_APPROVAL_NOT_CREATED");
  input.draft.awaitApproval({
    bindingRef: input.bindingRef,
    profileRefs: [input.profileRef],
    approvalRef: { id: submitted.command.approvalId, subjectHash: submitted.command.id },
    at: input.at,
  });
  return Object.freeze({
    draft: input.draft,
    command: submitted.command,
    replayed: submitted.replayed,
  });
}
