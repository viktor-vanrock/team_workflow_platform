import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaHumanActor,
  type QaVerdictAggregate,
  qaVerdictSignedEvent,
} from "@awp/competency-qa/node";

export async function persistQaVerdictSignatureEvents(
  manager: EntityManager,
  verdict: QaVerdictAggregate,
  authorization: { actor: QaHumanActor; basis: QaAuthorizationBasis },
  classificationKey: string,
  causationId: string,
) {
  const context = {
    actor: authorization.actor,
    authorizationBasis: authorization.basis,
    scope: {
      kind: "PROJECT" as const,
      workspaceId: verdict.workspaceId,
      projectId: verdict.projectId,
    },
    correlationId: randomUUID(),
    causationId,
  };
  const at = verdict.signatures.at(-1)!.signedAt;
  if (verdict.state === "SIGNED") {
    const event = qaVerdictSignedEvent({
      context,
      eventId: randomUUID(),
      classificationKey,
      occurredAt: at,
      verdict,
    });
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        randomUUID(),
        verdict.workspaceId,
        verdict.projectId,
        event.eventType,
        event.payload,
        qaAggregateSnapshotHash(event.payload as never),
        at,
      ],
    );
  }
  await manager.query(
    "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'qa.verdict.sign','SUCCEEDED','QA_VERDICT_SIGNATURE_PERSISTED',$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      verdict.workspaceId,
      verdict.projectId,
      at,
      authorization.actor,
      context.correlationId,
      context.causationId,
      authorization.basis,
      classificationKey,
      {
        values: {
          verdictId: verdict.verdictId,
          verdictHash: verdict.contentHash,
          signatureId: verdict.signatures.at(-1)!.signatureId,
          role: verdict.signatures.at(-1)!.role,
        },
        versionRefs: [verdict.ref],
      },
    ],
  );
}
