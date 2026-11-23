import { type QaPermission, qaPermissionCatalog } from "../manifest.ts";
import {
  assertQaVerifiedHuman,
  type QaAuthorizationBasis,
  QaDomainError,
  type QaWorkspaceContext,
} from "./primitives.ts";

export interface QaVerifiedHumanAttestation {
  readonly actorId: string;
  readonly actorKind: string;
  readonly permission: string;
  readonly authorizationBasis: QaAuthorizationBasis;
}

export function assertQaHumanAttestation(
  context: QaWorkspaceContext,
  attestation: QaVerifiedHumanAttestation,
): void {
  const actor = assertQaVerifiedHuman(context);
  if (attestation.actorKind !== "HUMAN") throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  if (
    actor.principalId !== attestation.actorId ||
    !qaPermissionCatalog.includes(attestation.permission as QaPermission) ||
    attestation.authorizationBasis.kind !== "PROJECT" ||
    attestation.authorizationBasis.policyVersion.length === 0
  ) {
    throw new QaDomainError("QA_HUMAN_ATTESTATION_MISMATCH");
  }
}

export function assertQaDistinctHumanActors(
  primary: QaVerifiedHumanAttestation,
  independent: QaVerifiedHumanAttestation,
): void {
  if (primary.actorId === independent.actorId) {
    throw new QaDomainError("QA_SEPARATION_OF_DUTIES_REQUIRED");
  }
}
