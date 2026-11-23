import { EntitySchema } from "typeorm";

const jsonb = { type: "jsonb" as const };
const timestamptz = { type: "timestamptz" as const };
const entity = (name: string, tableName: string, columns: Record<string, unknown>) =>
  new EntitySchema({ name, tableName, columns: columns as never });
export const ActionProvenanceEntity = entity("ActionProvenance", "action_provenance_records", {
  id: { type: String, primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  actor: jsonb,
  subject: jsonb,
  action: { type: String },
  effectClass: { name: "effect_class", type: String },
  configuration: jsonb,
  occurredAt: { name: "occurred_at", ...timestamptz },
});
export const IntakeCandidateEntity = entity("IntakeCandidate", "intake_candidates", {
  id: { type: "uuid", primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  deduplicationKey: { name: "deduplication_key", type: String },
  state: { type: String },
  currentSourceObservationVersion: { name: "current_source_observation_version", type: Number },
  currentSourceFingerprint: { name: "current_source_fingerprint", type: String },
  currentDecisionVersion: { name: "current_decision_version", type: Number },
  expiresAt: { name: "expires_at", ...timestamptz },
  rowVersion: { name: "row_version", type: Number },
});
export const IntakeCandidateObservationEntity = entity(
  "IntakeCandidateObservation",
  "intake_candidate_source_observations",
  {
    candidateId: { name: "candidate_id", type: "uuid", primary: true },
    version: { type: Number, primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    sourceFingerprint: { name: "source_fingerprint", type: String },
    minimalSummary: { name: "minimal_summary", ...jsonb },
    observedAt: { name: "observed_at", ...timestamptz },
  },
);
export const IntakeCandidateDecisionEntity = entity(
  "IntakeCandidateDecision",
  "intake_candidate_decisions",
  {
    candidateId: { name: "candidate_id", type: "uuid", primary: true },
    version: { type: Number, primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    decision: { type: String },
    createdAt: { name: "created_at", ...timestamptz },
  },
);
export const IntakeDraftRevisionEntity = entity("IntakeDraftRevision", "intake_draft_revisions", {
  id: { type: "uuid", primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  draftId: { name: "draft_id", type: "uuid" },
  revision: { type: Number },
  content: jsonb,
  contentHash: { name: "content_hash", type: String },
  createdAt: { name: "created_at", ...timestamptz },
});
export const IntakeDraftConfirmationEntity = entity(
  "IntakeDraftConfirmation",
  "intake_draft_confirmations",
  {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    draftId: { name: "draft_id", type: "uuid" },
    draftRevisionId: { name: "draft_revision_id", type: "uuid" },
    requestHash: { name: "request_hash", type: String },
    state: { type: String },
    recordedAt: { name: "recorded_at", ...timestamptz },
  },
);
export const ExternalInteractionReceiptEntity = entity(
  "ExternalInteractionReceipt",
  "external_interaction_receipts",
  {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    connectionId: { name: "connection_id", type: String },
    transportAttemptKey: { name: "transport_attempt_key", type: String },
    bodyHash: { name: "body_hash", type: String },
    normalizedEnvelope: { name: "normalized_envelope", ...jsonb },
    state: { type: String },
    receivedAt: { name: "received_at", ...timestamptz },
  },
);
export const InteractionIntentEntity = entity("InteractionIntent", "interaction_intents", {
  id: { type: String, primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  actorPrincipalId: { name: "actor_principal_id", type: "uuid" },
  action: jsonb,
  subject: jsonb,
  transport: jsonb,
  nonceHash: { name: "nonce_hash", type: String },
  tokenHandling: { name: "token_handling", ...jsonb },
  state: { type: String },
  expiresAt: { name: "expires_at", ...timestamptz },
  createdAt: { name: "created_at", ...timestamptz },
});
export const InteractionPresentationSecretEntity = entity(
  "InteractionPresentationSecret",
  "interaction_presentation_secrets",
  {
    id: { type: String, primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    intentId: { name: "intent_id", type: String },
    capsule: jsonb,
    aadHash: { name: "aad_hash", type: String },
    ciphertext: { type: "bytea" },
    ciphertextHash: { name: "ciphertext_hash", type: String },
    retainUntil: { name: "retain_until", ...timestamptz },
    erasedAt: { name: "erased_at", ...timestamptz, nullable: true },
  },
);
export const intakeInteractionEntities = Object.freeze([
  ActionProvenanceEntity,
  IntakeCandidateEntity,
  IntakeCandidateObservationEntity,
  IntakeCandidateDecisionEntity,
  IntakeDraftRevisionEntity,
  IntakeDraftConfirmationEntity,
  ExternalInteractionReceiptEntity,
  InteractionIntentEntity,
  InteractionPresentationSecretEntity,
]);
