import type { ActorReference } from "../shared/primitives.ts";

export type ActionSubject = Readonly<{
  kind:
    "CANDIDATE" | "DRAFT" | "DRAFT_REVISION" | "WORK_ITEM" | "AGENT_RUN" | "NOTIFICATION_INTENT";
  id: string;
  version: number;
  contentHash: string;
}>;

export type ActionEffectClass =
  | "READ_ONLY"
  | "PROPOSAL"
  | "DRAFT_MUTATION"
  | "NOTIFICATION_INTENT"
  | "APPROVAL_REQUIRED"
  | "DOMAIN_MUTATION";

export interface ActionProvenance {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actor: ActorReference;
  readonly delegatedHumanBasisHash?: string;
  readonly subject: ActionSubject;
  readonly action: string;
  readonly effectClass: ActionEffectClass;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly requestHash?: string;
  readonly authorizationBasisHash?: string;
  readonly occurredAt: Date;
}

function validate(value: ActionProvenance): void {
  if (!value.workspaceId || !value.projectId || !value.id)
    throw new Error("ACTION_PROVENANCE_SCOPE_REQUIRED");
  if (value.subject.version < 1 || !value.subject.contentHash)
    throw new Error("ACTION_PROVENANCE_SUBJECT_INVALID");
  if (
    value.action.startsWith("candidate.") &&
    (value.subject.kind !== "CANDIDATE" || value.effectClass !== "DOMAIN_MUTATION")
  )
    throw new Error("ACTION_PROVENANCE_CANDIDATE_COMBINATION_INVALID");
  if (
    value.action === "draft.revise" &&
    (value.actor.kind !== "HUMAN" ||
      !new Set(["DRAFT", "DRAFT_REVISION"]).has(value.subject.kind) ||
      value.effectClass !== "DRAFT_MUTATION")
  )
    throw new Error("ACTION_PROVENANCE_ACTOR_COMBINATION_INVALID");
  if (
    value.action === "draft.validate" &&
    (value.subject.kind !== "DRAFT_REVISION" || value.effectClass !== "PROPOSAL")
  )
    throw new Error("ACTION_PROVENANCE_VALIDATION_COMBINATION_INVALID");
  if (
    value.action.startsWith("agent.tool.") &&
    (value.actor.kind !== "SERVICE" || !value.delegatedHumanBasisHash)
  )
    throw new Error("ACTION_PROVENANCE_DELEGATION_REQUIRED");
  if (
    value.action === "notification.create" &&
    (value.subject.kind !== "NOTIFICATION_INTENT" || value.effectClass !== "NOTIFICATION_INTENT")
  )
    throw new Error("ACTION_PROVENANCE_NOTIFICATION_COMBINATION_INVALID");
}

export function createActionProvenance(input: ActionProvenance): ActionProvenance {
  validate(input);
  return Object.freeze(structuredClone(input));
}
