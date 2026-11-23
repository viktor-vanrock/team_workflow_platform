import type {
  ConfirmedOperationalEffect,
  PackConfirmationDelta,
  PackOwnedTransaction,
} from "@awp/competency-sdk";

import {
  QaDomainError,
  qaScopeFromContext,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import type { QaProjectContext } from "../domain/qa-project-context.ts";
import { createQaRequestExtension, type QaRequestExtension } from "../domain/qa-request.ts";
import {
  buildInitialQaRequestInputRevision,
  type QaDorSemanticInput,
  type QaRequestInputRevision,
  type QaResponseChannelResolution,
} from "../domain/qa-request-input-revision.ts";
import { buildQaAuditDelta } from "./domain-events.ts";
import type { QaOperationalRequestCreateResult } from "./operational-request-create-port.ts";
import { externalRequestRefFromResult, type QaConfirmedDraft } from "./qa-intake.ts";
import { qaRequestAcceptedEvent } from "./qa-request-events.ts";

export interface QaRequestConfirmationMaterial {
  readonly context: QaWorkspaceContext;
  readonly draft: QaConfirmedDraft;
  readonly projectContext: QaProjectContext;
  readonly responseChannelResolution: QaResponseChannelResolution;
  readonly semanticInput: QaDorSemanticInput;
  readonly blockersDeclared: boolean;
  readonly dependenciesDeclared: boolean;
}

export interface QaRequestConfirmationMaterialPort {
  load(
    input: ConfirmedOperationalEffect<QaOperationalRequestCreateResult>,
  ): Promise<QaRequestConfirmationMaterial>;
}

export interface QaIntakeConfirmationWriter {
  persist(
    transaction: PackOwnedTransaction,
    input: Readonly<{ extension: QaRequestExtension; initialInput: QaRequestInputRevision }>,
  ): Promise<Readonly<{ replayed: boolean }>>;
}

export interface QaConfirmationIds {
  extensionId(input: ConfirmedOperationalEffect): string;
  inputRevisionId(input: ConfirmedOperationalEffect): string;
  eventId(input: ConfirmedOperationalEffect): string;
}

export async function onQaRequestConfirmed(
  input: Readonly<{
    effect: ConfirmedOperationalEffect<QaOperationalRequestCreateResult> &
      Readonly<{ workItemId?: string }>;
    transaction: PackOwnedTransaction;
    materials: QaRequestConfirmationMaterialPort;
    writer: QaIntakeConfirmationWriter;
    ids: QaConfirmationIds;
    recordedAt: string;
  }>,
): Promise<PackConfirmationDelta> {
  const effect = input.effect;
  if (
    effect.capabilityKey !== "operational-work-item" ||
    effect.capabilityVersion !== "1.0.0" ||
    effect.operation !== "request.create" ||
    effect.result.operation !== "request.create" ||
    effect.result.normalizedStatus !== "NEW" ||
    effect.result.effectId !== effect.effectIdempotencyKey ||
    effect.source.intakeDraftId === undefined ||
    effect.workItemId === undefined ||
    effect.profileRefs.length === 0
  )
    throw new QaDomainError("QA_REQUEST_CONFIRMATION_INVALID");
  const material = await input.materials.load(effect);
  const scope = qaScopeFromContext(material.context);
  if (
    scope.workspaceId !== effect.workspaceId ||
    scope.projectId !== effect.projectId ||
    material.draft.id !== effect.source.intakeDraftId
  ) {
    throw new QaDomainError("QA_REQUEST_CONFIRMATION_SCOPE_MISMATCH");
  }
  if (!material.context.authorizationBasis)
    throw new QaDomainError("QA_CONFIRMATION_AUTHORIZATION_BASIS_REQUIRED");
  const initialInput = buildInitialQaRequestInputRevision({
    inputRevisionId: input.ids.inputRevisionId(effect),
    scope,
    workItemId: effect.workItemId,
    acceptedDraftRef: {
      kind: "intake-draft",
      id: material.draft.id,
      version: String(material.draft.version),
      contentHash: material.draft.contentHash,
    },
    externalRequestRef: externalRequestRefFromResult(effect.result),
    operationalBindingRef: effect.bindingRef,
    originalRequesterRef: material.draft.requester,
    title: material.draft.payload.title,
    requestKind: material.draft.payload.requestKind,
    semanticInput: material.semanticInput,
    blockersDeclared: material.blockersDeclared,
    dependenciesDeclared: material.dependenciesDeclared,
    dataClassificationKey: material.draft.authoritativeClassificationKey,
    responseChannelResolution: material.responseChannelResolution,
    recordedBy: material.draft.requester,
    authorizationBasis: material.context.authorizationBasis,
    recordedAt: input.recordedAt,
    correlationId: effect.correlationId,
    causationId: effect.causationId,
  });
  const extension = createQaRequestExtension({
    extensionId: input.ids.extensionId(effect),
    scope,
    workItemId: effect.workItemId,
    currentInput: initialInput,
    projectContext: material.projectContext,
    createdBy: material.draft.requester,
    createdAt: input.recordedAt,
    correlationId: effect.correlationId,
  });
  const persisted = await input.writer.persist(input.transaction, { extension, initialInput });
  return Object.freeze({
    idempotencyKey: input.transaction.idempotencyKey,
    replayed: persisted.replayed,
    events: Object.freeze([
      qaRequestAcceptedEvent({
        context: material.context,
        eventId: input.ids.eventId(effect),
        extension,
        initialInput,
        external: effect.result,
        bindingRef: effect.bindingRef,
        profileRefs: effect.profileRefs,
        occurredAt: input.recordedAt,
      }),
    ]),
    audit: Object.freeze([
      buildQaAuditDelta({
        action: "qa.request.confirm",
        outcome: persisted.replayed ? "REPLAYED" : "SUCCEEDED",
        reasonCode: "QA_REQUEST_EXTERNALLY_CONFIRMED",
        attributes: {
          commandId: effect.commandId,
          workItemId: effect.workItemId,
          extensionId: extension.extensionId,
          operation: effect.operation,
          profileCount: effect.profileRefs.length,
        },
      }),
    ]),
  });
}

export function createQaRequestConfirmationHook(
  dependencies: Readonly<{
    materials: QaRequestConfirmationMaterialPort;
    writer: QaIntakeConfirmationWriter;
    ids: QaConfirmationIds;
    now: () => string;
  }>,
) {
  return Object.freeze({
    key: "qa.request-create.confirmation",
    order: 2000,
    matches: (effect: ConfirmedOperationalEffect) =>
      effect.capabilityKey === "operational-work-item" &&
      effect.capabilityVersion === "1.0.0" &&
      effect.operation === "request.create",
    apply: async (
      effect: ConfirmedOperationalEffect<QaOperationalRequestCreateResult>,
      transaction: PackOwnedTransaction,
    ) =>
      await onQaRequestConfirmed({
        effect,
        transaction,
        ...dependencies,
        recordedAt: dependencies.now(),
      }),
  });
}
