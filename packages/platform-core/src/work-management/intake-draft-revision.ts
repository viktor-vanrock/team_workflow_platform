import { type JsonValue, sha256 } from "@awp/platform-contracts";

export type IntakeDraftConversationState =
  | "DRAFT"
  | "VALIDATING"
  | "NEEDS_INFO"
  | "READY_FOR_CONFIRMATION"
  | "CONFIRMED"
  | "OPERATIONAL_CREATE_PENDING"
  | "LINKED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL"
  | "CANCELLED";
export interface IntakeDraftRevision {
  readonly id: string;
  readonly revision: number;
  readonly content: Readonly<Record<string, JsonValue>>;
  readonly contentHash: string;
  readonly previousRevisionId?: string;
  readonly previousContentHash?: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}
export interface IntakeDraftRevisionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly state: IntakeDraftConversationState;
  readonly current: IntakeDraftRevision;
  readonly revisions: readonly IntakeDraftRevision[];
  readonly rowVersion: number;
  readonly confirmationRevision?: number;
}

function validatePartial(content: Readonly<Record<string, JsonValue>>): void {
  const allowed = new Set([
    "schemaVersion",
    "title",
    "requestKind",
    "goal",
    "scope",
    "acceptanceOutcome",
    "sourceRefs",
    "blockers",
    "dependencies",
    "requestedTarget",
    "requestRisk",
    "businessImpact",
    "requestedClassificationKey",
    "checklistRefs",
    "roleMetadataRefs",
    "sourceBuildRef",
    "defectRef",
    "previousSessionRef",
    "desiredDate",
  ]);
  if (Object.keys(content).some((key) => !allowed.has(key)))
    throw new Error("DRAFT_CONTENT_FIELD_INVALID");
  if (content.schemaVersion !== 1) throw new Error("DRAFT_CONTENT_SCHEMA_VERSION_INVALID");
}

export class IntakeDraftRevisionAggregate {
  #snapshot: IntakeDraftRevisionSnapshot;
  private constructor(snapshot: IntakeDraftRevisionSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }
  static create(input: {
    id: string;
    workspaceId: string;
    projectId: string;
    revisionId: string;
    content: Readonly<Record<string, JsonValue>>;
    createdBy: string;
    createdAt: Date;
  }): IntakeDraftRevisionAggregate {
    validatePartial(input.content);
    const current = {
      id: input.revisionId,
      revision: 1,
      content: structuredClone(input.content),
      contentHash: sha256(input.content),
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    };
    return new IntakeDraftRevisionAggregate({
      id: input.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      state: "DRAFT",
      current,
      revisions: [current],
      rowVersion: 1,
    });
  }
  snapshot(): IntakeDraftRevisionSnapshot {
    return structuredClone(this.#snapshot);
  }
  append(input: {
    revisionId: string;
    content: Readonly<Record<string, JsonValue>>;
    createdBy: string;
    createdAt: Date;
    expectedRowVersion: number;
    expectedContentHash: string;
  }): IntakeDraftRevision {
    if (
      this.#snapshot.rowVersion !== input.expectedRowVersion ||
      this.#snapshot.current.contentHash !== input.expectedContentHash
    )
      throw new Error("DRAFT_REVISION_CAS_CONFLICT");
    validatePartial(input.content);
    const hash = sha256(input.content);
    if (this.#snapshot.revisions.some(({ contentHash }) => contentHash === hash))
      throw new Error("DRAFT_REVISION_CONTENT_DUPLICATE");
    const current: IntakeDraftRevision = {
      id: input.revisionId,
      revision: this.#snapshot.current.revision + 1,
      content: structuredClone(input.content),
      contentHash: hash,
      previousRevisionId: this.#snapshot.current.id,
      previousContentHash: this.#snapshot.current.contentHash,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    };
    const next: { confirmationRevision?: number } & Omit<
      IntakeDraftRevisionSnapshot,
      "confirmationRevision"
    > = {
      ...this.#snapshot,
      state: "DRAFT",
      current,
      revisions: [...this.#snapshot.revisions, current],
      rowVersion: this.#snapshot.rowVersion + 1,
    };
    delete next.confirmationRevision;
    this.#snapshot = next;
    return structuredClone(current);
  }
  validate(expectedRevision: number, ready: boolean): IntakeDraftRevisionSnapshot {
    if (expectedRevision !== this.#snapshot.current.revision)
      throw new Error("DRAFT_REVISION_STALE");
    const required = ["schemaVersion", "title", "requestKind", "requestedClassificationKey"];
    if (ready && required.some((key) => this.#snapshot.current.content[key] === undefined))
      throw new Error("DRAFT_STRUCTURAL_MINIMUM_MISSING");
    this.#snapshot = {
      ...this.#snapshot,
      state: ready ? "READY_FOR_CONFIRMATION" : "NEEDS_INFO",
      rowVersion: this.#snapshot.rowVersion + 1,
    };
    return this.snapshot();
  }
  confirm(
    actorKind: "HUMAN" | "SERVICE",
    expectedRevision: number,
    expectedContentHash: string,
  ): IntakeDraftRevisionSnapshot {
    if (actorKind !== "HUMAN") throw new Error("DRAFT_CONFIRM_HUMAN_REQUIRED");
    if (
      this.#snapshot.state !== "READY_FOR_CONFIRMATION" ||
      expectedRevision !== this.#snapshot.current.revision ||
      expectedContentHash !== this.#snapshot.current.contentHash
    )
      throw new Error("DRAFT_CONFIRM_SNAPSHOT_CONFLICT");
    this.#snapshot = {
      ...this.#snapshot,
      state: "CONFIRMED",
      confirmationRevision: expectedRevision,
      rowVersion: this.#snapshot.rowVersion + 1,
    };
    return this.snapshot();
  }
}
