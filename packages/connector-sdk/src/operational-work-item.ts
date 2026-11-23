import type { ConnectorRuntimeContext } from "./runtime-context.ts";

export const operationalWorkItemCapability = Object.freeze({
  key: "operational-work-item",
  version: "1.0.0",
  operations: Object.freeze(["request.create", "request.transition", "defect.create"] as const),
});

export const operationalWorkItemCapabilityV1_1 = Object.freeze({
  key: "operational-work-item",
  version: "1.1.0",
  operations: Object.freeze([
    "request.create",
    "request.transition",
    "request.assign",
    "request.set-priority",
    "request.set-due-date",
    "defect.create",
  ] as const),
});

export type OperationalWorkItemOperation =
  (typeof operationalWorkItemCapabilityV1_1.operations)[number];

export type OperationalNormalizedStatus =
  | "NEW"
  | "NEEDS_INFO"
  | "READY"
  | "PLANNED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "DONE"
  | "CANCELLED";

export interface OperationalImmutableRef {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly contentHash: `sha256:${string}`;
}

export interface OperationalWorkItemTarget {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityKind: "REQUEST" | "DEFECT";
  readonly authorityScopeKey: string;
  readonly naturalKey?: string;
  readonly externalEntityId?: string;
}

export interface OperationalRequestCreateInput {
  readonly sourceDraftId: string;
  readonly workTypeKey: "qa.validation";
  readonly workTypeVersion: "1.0.0";
  readonly requestKind: "feature-validation" | "smoke" | "regression" | "retest" | "investigation";
  /** Exact human title. It is required even when the semantic DoR is incomplete. */
  readonly summary: string;
  /** Omitted when the confirmed Draft does not contain an exact human value. */
  readonly description?: string;
  /** Omitted when the confirmed Draft does not contain an exact human value. */
  readonly acceptanceOutcome?: string;
  readonly sourceRefs?: readonly OperationalImmutableRef[];
  readonly requestedNormalizedStatus: "NEW";
  readonly dataClassificationKey: string;
}

export interface OperationalCompletionSummary {
  readonly schemaVersion: 1;
  readonly scope?: Readonly<{
    readonly workspaceId: string;
    readonly projectId: string;
    readonly workItemId: string;
  }>;
  readonly verdictRef?:
    | OperationalImmutableRef
    | Readonly<{
        readonly id: string;
        readonly version: number;
        readonly contentHash: `sha256:${string}`;
      }>;
  readonly verdict: string;
  readonly residualRisk?: string;
  readonly evidenceManifestRefs?: readonly Readonly<{
    readonly id: string;
    readonly version: number;
    readonly contentHash: `sha256:${string}`;
  }>[];
  readonly defectLinkOrDispositionRefs?: readonly Readonly<{
    readonly kind: "DEFECT_LINK" | "DISPOSITION";
    readonly id: string;
    readonly version: number;
    readonly contentHash: `sha256:${string}`;
  }>[];
  readonly summary: string;
  readonly contentHash: `sha256:${string}`;
}

export interface OperationalRequestTransitionInput {
  readonly requestedNormalizedStatus: "READY" | "DONE";
  readonly expectedExternalVersion: string;
  readonly completionSummary?: OperationalCompletionSummary;
}

export interface OperationalRequestAssignInput {
  readonly assignment: Readonly<{ canonicalPrincipalId: string }> | Readonly<{ unassign: true }>;
}

export interface OperationalRequestSetPriorityInput {
  readonly normalizedPriorityKey: string;
}

export interface OperationalRequestSetDueDateInput {
  readonly dueDate: string | null;
}

export interface OperationalDefectCreateInput {
  readonly sourceWorkItemId: string;
  readonly summary: string;
  readonly description: string;
  readonly dataClassificationKey: string;
  readonly sourceRefs: readonly OperationalImmutableRef[];
}

export interface OperationalWorkItemResult<
  TOperation extends OperationalWorkItemOperation = OperationalWorkItemOperation,
> {
  readonly operation: TOperation;
  readonly entityKind: TOperation extends "defect.create" ? "DEFECT" : "REQUEST";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: string;
  readonly normalizedStatus: TOperation extends "request.create" | "defect.create"
    ? "NEW"
    : "READY" | "DONE";
  readonly naturalKey: string;
  readonly effectId: string;
  readonly observedAt: string;
  readonly completionSummaryReceipt?: Readonly<{
    id: string;
    contentHash: `sha256:${string}`;
  }>;
}

export type OperationalRequestCreateResult = OperationalWorkItemResult<"request.create">;
export type OperationalRequestTransitionResult = OperationalWorkItemResult<"request.transition">;
export type OperationalDefectCreateResult = OperationalWorkItemResult<"defect.create">;

export type OperationalActionInput =
  | Readonly<{
      schemaVersion: "1.0";
      operation: "request.transition";
      requestedNormalizedStatus: "READY" | "DONE";
      expectedExternalVersion: string;
    }>
  | Readonly<{
      schemaVersion: "1.1";
      operation: "request.transition";
      targetNormalizedStatus: OperationalNormalizedStatus;
    }>
  | Readonly<{
      schemaVersion: "1.1";
      operation: "request.assign";
      assignment: Readonly<{ canonicalPrincipalId: string }> | Readonly<{ unassign: true }>;
    }>
  | Readonly<{
      schemaVersion: "1.1";
      operation: "request.set-priority";
      normalizedPriorityKey: string;
    }>
  | Readonly<{ schemaVersion: "1.1"; operation: "request.set-due-date"; dueDate: string | null }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stableKey = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

export function assertOperationalActionInput(
  value: unknown,
): asserts value is OperationalActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  const input = value as Record<string, unknown>;
  const allowed = (...keys: string[]) => Object.keys(input).every((key) => keys.includes(key));
  if (input.schemaVersion === "1.0" && input.operation === "request.transition") {
    if (
      !allowed(
        "schemaVersion",
        "operation",
        "requestedNormalizedStatus",
        "expectedExternalVersion",
      ) ||
      !["READY", "DONE"].includes(String(input.requestedNormalizedStatus)) ||
      typeof input.expectedExternalVersion !== "string" ||
      !input.expectedExternalVersion
    )
      throw new OperationalConnectorError("SCHEMA_DRIFT", false);
    return;
  }
  if (input.schemaVersion !== "1.1") throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  if (input.operation === "request.transition") {
    if (
      !allowed("schemaVersion", "operation", "targetNormalizedStatus") ||
      ![
        "NEW",
        "NEEDS_INFO",
        "READY",
        "PLANNED",
        "IN_PROGRESS",
        "REVIEW",
        "BLOCKED",
        "DONE",
        "CANCELLED",
      ].includes(String(input.targetNormalizedStatus))
    )
      throw new OperationalConnectorError("SCHEMA_DRIFT", false);
    return;
  }
  if (input.operation === "request.assign") {
    if (
      !allowed("schemaVersion", "operation", "assignment") ||
      !input.assignment ||
      typeof input.assignment !== "object" ||
      Array.isArray(input.assignment)
    )
      throw new OperationalConnectorError("SCHEMA_DRIFT", false);
    const assignment = input.assignment as Record<string, unknown>;
    const valid =
      Object.keys(assignment).length === 1 &&
      ((typeof assignment.canonicalPrincipalId === "string" &&
        uuid.test(assignment.canonicalPrincipalId)) ||
        assignment.unassign === true);
    if (!valid) throw new OperationalConnectorError("SCHEMA_DRIFT", false);
    return;
  }
  if (input.operation === "request.set-priority") {
    if (
      !allowed("schemaVersion", "operation", "normalizedPriorityKey") ||
      typeof input.normalizedPriorityKey !== "string" ||
      !stableKey.test(input.normalizedPriorityKey)
    )
      throw new OperationalConnectorError("SCHEMA_DRIFT", false);
    return;
  }
  if (input.operation === "request.set-due-date") {
    if (
      !allowed("schemaVersion", "operation", "dueDate") ||
      (input.dueDate !== null &&
        (typeof input.dueDate !== "string" || !isoDate.test(input.dueDate)))
    )
      throw new OperationalConnectorError("SCHEMA_DRIFT", false);
    return;
  }
  throw new OperationalConnectorError("SCHEMA_DRIFT", false);
}

export type OperationalConnectorErrorCode =
  | "CONNECTOR_UNAUTHORIZED"
  | "CONNECTOR_FORBIDDEN"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "SCHEMA_DRIFT"
  | "EXPECTED_STATE_CONFLICT"
  | "EFFECT_IDEMPOTENCY_CONFLICT"
  | "OPERATION_UNAVAILABLE"
  | "RESULT_SCOPE_MISMATCH"
  | "RESULT_PROFILE_MISMATCH";

export class OperationalConnectorError extends Error {
  constructor(
    readonly code: OperationalConnectorErrorCode,
    readonly retryable: boolean,
    message: string = code,
  ) {
    super(message);
    this.name = "OperationalConnectorError";
  }
}

export interface OperationalRequestCreateOperation {
  create(
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    input: OperationalRequestCreateInput,
  ): Promise<OperationalRequestCreateResult>;
  readByEffect(
    context: ConnectorRuntimeContext,
    effectIdempotencyKey: string,
  ): Promise<OperationalRequestCreateResult | undefined>;
}

export interface OperationalRequestTransitionOperation {
  transition(
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    input: OperationalRequestTransitionInput,
  ): Promise<OperationalRequestTransitionResult>;
  readByEffect(
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    effectIdempotencyKey: string,
  ): Promise<OperationalRequestTransitionResult | undefined>;
}

export interface OperationalDefectCreateOperation {
  createDefect(
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    input: OperationalDefectCreateInput,
  ): Promise<OperationalDefectCreateResult>;
  readByEffect(
    context: ConnectorRuntimeContext,
    effectIdempotencyKey: string,
  ): Promise<OperationalDefectCreateResult | undefined>;
}

export function assertOperationalTarget(target: OperationalWorkItemTarget): void {
  const hasNaturalKey = typeof target.naturalKey === "string";
  const hasExternalId = typeof target.externalEntityId === "string";
  if (
    target.workspaceId.length === 0 ||
    target.projectId.length === 0 ||
    target.authorityScopeKey.length === 0 ||
    hasNaturalKey === hasExternalId
  ) {
    throw new OperationalConnectorError("RESULT_SCOPE_MISMATCH", false);
  }
}

export function assertSparseRequestCreate(input: OperationalRequestCreateInput): void {
  if (
    input.sourceDraftId.length === 0 ||
    input.summary.trim().length === 0 ||
    input.dataClassificationKey.length === 0 ||
    input.requestedNormalizedStatus !== "NEW"
  ) {
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  }
  if (input.description !== undefined && input.description.trim().length === 0) {
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  }
  if (input.acceptanceOutcome !== undefined && input.acceptanceOutcome.trim().length === 0) {
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  }
}

export function assertOperationalRequestTransition(input: OperationalRequestTransitionInput): void {
  if (
    (input.requestedNormalizedStatus !== "READY" && input.requestedNormalizedStatus !== "DONE") ||
    input.expectedExternalVersion.length === 0
  )
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  if (input.requestedNormalizedStatus === "READY" && input.completionSummary !== undefined)
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  if (input.requestedNormalizedStatus === "DONE" && input.completionSummary === undefined)
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  if (input.requestedNormalizedStatus === "DONE") {
    const summary = input.completionSummary!;
    if (
      summary.schemaVersion !== 1 ||
      !summary.verdict ||
      !summary.summary.trim() ||
      !summary.contentHash.startsWith("sha256:") ||
      (summary.scope !== undefined &&
        (!summary.scope.workspaceId || !summary.scope.projectId || !summary.scope.workItemId)) ||
      (summary.residualRisk !== undefined && !summary.residualRisk.trim()) ||
      (summary.evidenceManifestRefs !== undefined && summary.evidenceManifestRefs.length === 0) ||
      (summary.defectLinkOrDispositionRefs !== undefined &&
        (summary.defectLinkOrDispositionRefs.length === 0 ||
          summary.defectLinkOrDispositionRefs.some(
            ({ kind }) => kind !== "DEFECT_LINK" && kind !== "DISPOSITION",
          )))
    )
      throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  }
}

export function assertOperationalDefectCreate(input: OperationalDefectCreateInput): void {
  if (
    !input.sourceWorkItemId ||
    !input.summary.trim() ||
    !input.description.trim() ||
    !input.dataClassificationKey ||
    input.sourceRefs.length === 0 ||
    input.sourceRefs.some(
      (ref) => !ref.kind || !ref.id || !ref.version || !ref.contentHash.startsWith("sha256:"),
    )
  )
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
}
