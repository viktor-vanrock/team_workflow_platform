import type { QaVersionedReference, QaWorkspaceContext } from "../domain/primitives.ts";
import type { QaRequestExtension } from "../domain/qa-request.ts";
import {
  type QaRequestInputRevision,
  qaRequestInputRevisionRef,
} from "../domain/qa-request-input-revision.ts";
import { qaSchemaReferences } from "../manifest.ts";
import { buildQaDomainEvent, qaDomainEventDelta } from "./domain-events.ts";

export function qaRequestAcceptedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    extension: QaRequestExtension;
    initialInput: QaRequestInputRevision;
    external: Readonly<{
      externalEntityId: string;
      externalVersion: string;
      rawExternalState: string;
      normalizedStatus: "NEW";
    }>;
    bindingRef: QaVersionedReference;
    profileRefs: readonly QaVersionedReference[];
    occurredAt: string;
  }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.request.accepted",
      entityType: "qa-request",
      entityId: input.extension.extensionId,
      entityVersion: input.extension.resourceVersion,
      occurredAt: input.occurredAt,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.initialInput.dataClassificationKey,
      payloadSchemaRef: Object.freeze({
        id: "urn:awp:schemas:qa:event-payload:request-accepted:v1",
        version: 1,
        digest: qaSchemaReferences.events.digest,
      }),
      payload: Object.freeze({
        workItemId: input.extension.workItemId,
        qaRequestExtensionId: input.extension.extensionId,
        initialRequestInputRevisionRef: qaRequestInputRevisionRef(input.initialInput),
        externalRequestId: input.external.externalEntityId,
        externalVersion: input.external.externalVersion,
        rawExternalState: input.external.rawExternalState,
        normalizedStatus: input.external.normalizedStatus,
        bindingRef: input.bindingRef,
        profileRefs: input.profileRefs,
      }),
    }),
  );
}
