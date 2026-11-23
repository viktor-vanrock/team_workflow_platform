import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "../domain/primitives.ts";
import { QaVerdictAggregate, type QaVerdictSignature } from "../domain/verdict.ts";

interface SignerInput {
  readonly actor: QaHumanActor;
  readonly role: string;
  readonly permission: string;
  readonly liveAuthorized: boolean;
  readonly authorizationBasisHash: QaContentHash;
}

function signatureId(verdict: QaVerdictAggregate, role: string, actorId: string): string {
  return qaAggregateSnapshotHash({ verdictId: verdict.verdictId, role, actorId } as never).slice(
    7,
    39,
  );
}

export function signQaVerdict(
  verdict: QaVerdictAggregate,
  input: SignerInput & Readonly<{ at: string }>,
): QaVerdictSignature {
  if (
    input.actor.kind !== "HUMAN" ||
    input.role !== "QA_EXECUTOR" ||
    input.permission !== "qa.verdict.sign" ||
    !input.liveAuthorized
  ) {
    throw new QaDomainError("QA_VERDICT_PRIMARY_NOT_AUTHORIZED");
  }
  const signature = Object.freeze({
    signatureId: signatureId(verdict, "PRIMARY", input.actor.principalId),
    role: "PRIMARY" as const,
    verdictContentHash: verdict.contentHash,
    signer: structuredClone(input.actor),
    authorizationBasisHash: input.authorizationBasisHash,
    signedAt: input.at,
  });
  verdict.addSignature(signature);
  return signature;
}

export function cosignQaVerdict(
  verdict: QaVerdictAggregate,
  input: SignerInput &
    Readonly<{
      actionRef: QaExactReference;
      expiresAt: string;
      now: string;
      subjectMatches?: boolean;
    }>,
): QaVerdictSignature {
  const primary = verdict.signatures.find(({ role }) => role === "PRIMARY");
  if (primary?.signer.principalId === input.actor.principalId)
    throw new QaDomainError("QA_VERDICT_COSIGN_DISTINCT_ACTOR_REQUIRED");
  if (
    input.actor.kind !== "HUMAN" ||
    input.role !== "QA_LEAD" ||
    input.permission !== "qa.verdict.cosign" ||
    !input.liveAuthorized ||
    input.subjectMatches === false ||
    Date.parse(input.expiresAt) <= Date.parse(input.now)
  )
    throw new QaDomainError("QA_VERDICT_COSIGN_NOT_AUTHORIZED");
  const signature = Object.freeze({
    signatureId: signatureId(verdict, "LEAD_COSIGN", input.actor.principalId),
    role: "LEAD_COSIGN" as const,
    verdictContentHash: verdict.contentHash,
    signer: structuredClone(input.actor),
    authorizationBasisHash: input.authorizationBasisHash,
    actionRef: Object.freeze(structuredClone(input.actionRef)),
    signedAt: input.now,
  });
  verdict.addSignature(signature);
  return signature;
}
