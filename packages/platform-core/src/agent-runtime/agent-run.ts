import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { AgentEffectClass, AgentSubjectKind } from "./skill-registry.ts";

export interface AgentRunSubject {
  readonly kind: AgentSubjectKind;
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
  readonly aggregateSnapshotHash: string;
}
export interface AgentToolGrant {
  readonly action: string;
  readonly effectClass: AgentEffectClass;
  readonly subject: AgentRunSubject;
  readonly classificationCeiling: string;
}
export type AgentRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "FALLBACK_COMPLETED";
export interface AgentRunSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly requestKey: string;
  readonly requestHash: string;
  readonly subject: AgentRunSubject;
  readonly humanPrincipalId: string;
  readonly servicePrincipalId: string;
  readonly grants: readonly AgentToolGrant[];
  readonly grantSetHash: string;
  readonly status: AgentRunStatus;
  readonly result?: unknown;
  readonly rowVersion: number;
}

export function deriveAgentGrants(input: {
  subject: AgentRunSubject;
  serviceCeiling: readonly string[];
  skillAllowlist: readonly Readonly<{ action: string; effectClass: AgentEffectClass }>[];
  humanAllowedActions: readonly string[];
  classificationCeiling: string;
}): readonly AgentToolGrant[] {
  const human = new Set(input.humanAllowedActions);
  const service = new Set(input.serviceCeiling);
  return Object.freeze(
    input.skillAllowlist
      .filter(({ action }) => human.has(action) && service.has(action))
      .map(({ action, effectClass }) =>
        Object.freeze({
          action,
          effectClass,
          subject: structuredClone(input.subject),
          classificationCeiling: input.classificationCeiling,
        }),
      ),
  );
}

export class AgentRunAggregate {
  #snapshot: AgentRunSnapshot;
  private constructor(snapshot: AgentRunSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }
  static start(
    input: Omit<AgentRunSnapshot, "requestHash" | "grantSetHash" | "status" | "rowVersion"> & {
      requestPayload: JsonValue;
    },
  ): AgentRunAggregate {
    if (!new Set(["DRAFT", "CANDIDATE", "WORK_ITEM"]).has(input.subject.kind))
      throw new Error("AGENT_SUBJECT_INVALID");
    const requestHash = sha256(input.requestPayload);
    const grantSetHash = sha256(input.grants as unknown as JsonValue);
    return new AgentRunAggregate({
      ...input,
      requestHash,
      grantSetHash,
      status: "QUEUED",
      rowVersion: 1,
    });
  }
  static restore(snapshot: AgentRunSnapshot): AgentRunAggregate {
    if (
      !new Set(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "FALLBACK_COMPLETED"]).has(
        snapshot.status,
      )
    )
      throw new Error("AGENT_RUN_STATUS_INVALID");
    if (!Number.isInteger(snapshot.rowVersion) || snapshot.rowVersion < 1)
      throw new Error("AGENT_RUN_VERSION_INVALID");
    return new AgentRunAggregate(snapshot);
  }
  snapshot(): AgentRunSnapshot {
    return structuredClone(this.#snapshot);
  }
  assertReplay(requestKey: string, requestPayload: JsonValue): AgentRunSnapshot {
    if (
      requestKey !== this.#snapshot.requestKey ||
      sha256(requestPayload) !== this.#snapshot.requestHash
    )
      throw new Error("AGENT_RUN_IDEMPOTENCY_CONFLICT");
    return this.snapshot();
  }
  begin(): void {
    if (this.#snapshot.status !== "QUEUED") throw new Error("AGENT_RUN_NOT_QUEUED");
    this.#snapshot = {
      ...this.#snapshot,
      status: "RUNNING",
      rowVersion: this.#snapshot.rowVersion + 1,
    };
  }
  complete(result: unknown, fallback = false): void {
    if (this.#snapshot.status !== "RUNNING") throw new Error("AGENT_RUN_NOT_RUNNING");
    this.#snapshot = {
      ...this.#snapshot,
      status: fallback ? "FALLBACK_COMPLETED" : "COMPLETED",
      result: structuredClone(result),
      rowVersion: this.#snapshot.rowVersion + 1,
    };
  }
}
