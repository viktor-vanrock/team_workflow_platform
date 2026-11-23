import { type JsonValue, sha256 } from "@awp/platform-contracts";

import { isSystemAdministratorRole } from "../access/role-key.ts";
import {
  assertBindingPublicationDecision,
  type BindingPublicationApprover,
} from "./binding-publication-policy.ts";
import type { PlatformAction } from "./platform-action-port.ts";

export interface BindingCandidateSnapshot {
  readonly bindingId: string;
  readonly version: number;
  readonly resourceVersion: number;
  readonly contentHash: string;
  readonly currentPublishedVersion: number | null;
  readonly state?: "VALIDATED" | "PUBLISHED";
}
export interface PublishedBinding extends BindingCandidateSnapshot {
  readonly currentPublishedVersion: number;
  readonly state: "PUBLISHED";
}
export type BindingAction = PlatformAction<BindingCandidateSnapshot, PublishedBinding>;
export class InMemoryPlatformActionRepository {
  #candidate: BindingCandidateSnapshot;
  readonly #actions = new Map<string, BindingAction>();
  #sequence = 0;
  #driftAfterSnapshot = false;
  constructor(candidate: BindingCandidateSnapshot) {
    this.#candidate = { ...candidate, state: "VALIDATED" };
  }
  snapshotCandidate(id: string, version: number): BindingCandidateSnapshot {
    if (this.#candidate.bindingId !== id || this.#candidate.version !== version)
      throw new Error("BINDING_CANDIDATE_NOT_FOUND");
    const snapshot = structuredClone(this.#candidate);
    if (this.#driftAfterSnapshot) {
      this.#candidate = { ...this.#candidate, contentHash: "sha256:drifted" };
      this.#driftAfterSnapshot = false;
    }
    return snapshot;
  }
  nextId(): string {
    this.#sequence += 1;
    return `binding-action-${this.#sequence}`;
  }
  save(action: BindingAction): void {
    this.#actions.set(action.id, structuredClone(action));
  }
  action(id: string): BindingAction | undefined {
    const value = this.#actions.get(id);
    return value ? structuredClone(value) : undefined;
  }
  publish(action: BindingAction): PublishedBinding {
    if (action.state === "COMPLETED" && action.result) return action.result;
    if (
      this.#candidate.contentHash !== action.candidate.contentHash ||
      this.#candidate.resourceVersion !== action.candidate.resourceVersion ||
      this.#candidate.currentPublishedVersion !== action.candidate.currentPublishedVersion
    )
      throw new Error("CANDIDATE_DRIFT");
    const binding: PublishedBinding = {
      ...this.#candidate,
      state: "PUBLISHED",
      resourceVersion: this.#candidate.resourceVersion + 1,
      currentPublishedVersion: this.#candidate.version,
    };
    this.#candidate = binding;
    this.#actions.set(action.id, {
      ...action,
      state: "COMPLETED",
      result: binding,
      rowVersion: action.rowVersion + 1,
    });
    return structuredClone(binding);
  }
  driftCandidate(): void {
    this.#candidate = {
      ...this.#candidate,
      state: "VALIDATED",
      resourceVersion: 2,
      currentPublishedVersion: 0,
    };
    this.#driftAfterSnapshot = true;
  }
}
export class BindingPublicationService {
  constructor(private readonly repository: InMemoryPlatformActionRepository) {}
  async request(
    input: Readonly<{
      initiatorId: string;
      initiatorRole: string;
      candidateRef: Readonly<{ id: string; version: number }>;
      expectedResourceVersion: number;
    }>,
  ): Promise<
    Readonly<{
      action: BindingAction;
      approval: Readonly<{ actionId: string; subjectHash: string }>;
    }>
  > {
    if (!isSystemAdministratorRole(input.initiatorRole))
      throw new Error("BINDING_PUBLICATION_INITIATOR_UNAUTHORIZED");
    const candidate = this.repository.snapshotCandidate(
      input.candidateRef.id,
      input.candidateRef.version,
    );
    if (candidate.resourceVersion !== input.expectedResourceVersion)
      throw new Error("ETAG_MISMATCH");
    const id = this.repository.nextId();
    const candidateHash = sha256(candidate as unknown as JsonValue);
    const action: BindingAction = {
      id,
      kind: "BINDING_PUBLICATION",
      candidate,
      candidateHash,
      initiatorId: input.initiatorId,
      state: "PENDING_APPROVAL",
      rowVersion: 1,
    };
    this.repository.save(action);
    return Object.freeze({
      action,
      approval: {
        actionId: id,
        subjectHash: sha256({
          actionKind: "PLATFORM_ACTION",
          actionId: id,
          candidateHash,
        } as JsonValue),
      },
    });
  }
  async approve(
    actionId: string,
    approver: BindingPublicationApprover,
  ): Promise<Readonly<{ action: BindingAction; binding: PublishedBinding }>> {
    const action = this.repository.action(actionId);
    if (!action) throw new Error("PLATFORM_ACTION_NOT_FOUND");
    if (action.state === "COMPLETED" && action.result)
      return Object.freeze({ action, binding: action.result });
    assertBindingPublicationDecision(action.initiatorId, approver);
    const binding = this.repository.publish(action);
    return Object.freeze({ action: this.repository.action(actionId)!, binding });
  }
}
