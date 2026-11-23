import { randomBytes } from "node:crypto";

import type { MessagingLogicalTarget } from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface CandidateActionIntentIssuer {
  issue(
    input: Readonly<{
      id: string;
      actionKind: "CANDIDATE_CREATE" | "CANDIDATE_SNOOZE" | "CANDIDATE_IGNORE";
      tokenHash: string;
      candidateId: string;
      candidateVersion: number;
      sourceObservationVersion: number;
      principalId: string;
      target: MessagingLogicalTarget;
      expiresAt: Date;
    }>,
  ): Promise<void>;
}
export async function createCandidateActionSet(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    candidateId: string;
    candidateVersion: number;
    sourceObservationVersion: number;
    principalId: string;
    target: MessagingLogicalTarget;
    expiresAt: Date;
    issuer: CandidateActionIntentIssuer;
  }>,
) {
  const actions = ["CANDIDATE_CREATE", "CANDIDATE_SNOOZE", "CANDIDATE_IGNORE"] as const;
  const items = [];
  for (const [index, actionKind] of actions.entries()) {
    const token = randomBytes(32).toString("base64url");
    const id = `candidate-action:${sha256({ candidateId: input.candidateId, candidateVersion: input.candidateVersion, sourceObservationVersion: input.sourceObservationVersion, actionKind, index, tokenHash: sha256(token) }).slice(7, 39)}`;
    await input.issuer.issue({
      id,
      actionKind,
      tokenHash: sha256(token),
      candidateId: input.candidateId,
      candidateVersion: input.candidateVersion,
      sourceObservationVersion: input.sourceObservationVersion,
      principalId: input.principalId,
      target: input.target,
      expiresAt: input.expiresAt,
    });
    items.push(Object.freeze({ id, actionKind, token }));
  }
  return Object.freeze({
    presentationKind: "CANDIDATE_DECISION" as const,
    actions: Object.freeze(items),
    payloadHash: sha256(items.map(({ id, actionKind }) => ({ id, actionKind })) as JsonValue),
  });
}
