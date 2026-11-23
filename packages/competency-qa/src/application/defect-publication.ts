import type { QaDefectDraftAggregate } from "../domain/defect-publication.ts";
import { QaDomainError } from "../domain/primitives.ts";

export interface QaDefectPublicationApproval {
  readonly state: "APPROVED" | "REJECTED" | "PENDING";
  readonly expiresAt: string;
  readonly subjectHashExact: boolean;
  readonly bindingProfileExact: boolean;
  readonly consumed: boolean;
}

export class QaDefectPublicationService {
  readonly #inFlight = new Set<string>();
  readonly #consumed = new Set<string>();
  constructor(
    private readonly dependencies: Readonly<{
      invoke: (draft: QaDefectDraftAggregate) => Promise<unknown>;
      now: () => string;
    }>,
  ) {}

  async publish(
    input: Readonly<{
      draft: QaDefectDraftAggregate;
      actor: Readonly<{ kind: string; principalId: string }>;
      role: string;
      permission: string;
      approval: QaDefectPublicationApproval;
    }>,
  ): Promise<unknown> {
    if (
      input.actor.kind !== "HUMAN" ||
      (input.role !== "QA_EXECUTOR" && input.role !== "QA_LEAD") ||
      input.permission !== "qa.defect.publish"
    )
      throw new QaDomainError("QA_DEFECT_PUBLISH_PERMISSION_DENIED");
    if (input.draft.state !== "AUTHORIZED")
      throw new QaDomainError("QA_DEFECT_DRAFT_NOT_AUTHORIZED");
    if (
      input.approval.state !== "APPROVED" ||
      input.approval.consumed ||
      !input.approval.subjectHashExact ||
      !input.approval.bindingProfileExact
    )
      throw new QaDomainError("QA_DEFECT_APPROVAL_NOT_EXACT");
    if (Date.parse(this.dependencies.now()) >= Date.parse(input.approval.expiresAt))
      throw new QaDomainError("QA_DEFECT_APPROVAL_EXPIRED");
    if (
      this.#consumed.has(input.draft.defectDraftId) ||
      this.#inFlight.has(input.draft.defectDraftId)
    )
      throw new QaDomainError("QA_DEFECT_APPROVAL_ALREADY_CONSUMED");
    this.#inFlight.add(input.draft.defectDraftId);
    try {
      const result = await this.dependencies.invoke(input.draft);
      this.#consumed.add(input.draft.defectDraftId);
      return result;
    } finally {
      this.#inFlight.delete(input.draft.defectDraftId);
    }
  }
}
