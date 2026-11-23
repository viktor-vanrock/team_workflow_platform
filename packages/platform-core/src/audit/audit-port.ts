import type {
  ActorReference,
  AuthorizationBasisRef,
  ClassificationReference,
  ResourceScope,
  Uuid,
  VersionedReference,
} from "../shared/primitives.ts";

export interface AuditEvent {
  readonly id: Uuid;
  readonly occurredAt: Date;
  readonly scope: ResourceScope;
  readonly actor: ActorReference;
  readonly action: string;
  readonly outcome: "SUCCEEDED" | "DENIED" | "FAILED" | "ACCEPTED";
  readonly reasonCode: string;
  readonly correlationId: Uuid;
  readonly causationId: Uuid;
  readonly authorizationBasis?: AuthorizationBasisRef;
  readonly classification: ClassificationReference;
  readonly versionRefs: readonly VersionedReference[];
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AppendOnlyAuditPort {
  append(event: AuditEvent): Promise<void>;
  query(
    scope: ResourceScope,
    filter: Readonly<{ correlationId?: Uuid; action?: string }>,
  ): Promise<readonly AuditEvent[]>;
}

export interface AuthorizationDecisionRecorder {
  recordDecision(
    event: Omit<AuditEvent, "outcome"> & Readonly<{ decision: "ALLOW" | "DENY" }>,
  ): Promise<void>;
}
