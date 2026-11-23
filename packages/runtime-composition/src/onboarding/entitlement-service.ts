import {
  createProjectEntitlementRevision,
  onboardingContentHash,
  type ProjectEntitlementRevision,
  type ProjectScope,
} from "@awp/platform-core";
import type { ProjectAuthorizationWitness } from "@awp/platform-persistence-typeorm";

interface EntitlementRepositoryPort {
  current(
    scope: ProjectScope,
    entitlementId: string,
  ): Promise<ProjectEntitlementRevision | undefined>;
  append(revision: ProjectEntitlementRevision): Promise<void>;
  currentAuthorizationWitness?(
    scope: ProjectScope,
    principalId: string,
    permission: string,
    at: Date,
  ): Promise<ProjectAuthorizationWitness>;
}

export interface ProjectEntitlementChange extends ProjectScope {
  readonly idempotencyKey: string;
  readonly expectedVersion: number;
  readonly entitlementId: string;
  readonly principalId: string;
  readonly operation: "GRANT" | "REPLACE" | "REVOKE";
  readonly effect: "ALLOW" | "DENY";
  readonly permissions: readonly string[];
  readonly classificationCeilingKey: string;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly revokedAt?: string;
  readonly actor: ProjectEntitlementRevision["actor"];
  readonly reason: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface ProjectEntitlementChangeResult {
  readonly revision: ProjectEntitlementRevision;
  readonly replayed: boolean;
  readonly audit: Readonly<{
    action: "PROJECT_ENTITLEMENT_CHANGED";
    before?: ProjectEntitlementRevision;
    after: ProjectEntitlementRevision;
    correlationId: string;
  }>;
  readonly event: Readonly<{
    type: "PROJECT_ENTITLEMENTS_CHANGED";
    workspaceId: string;
    projectId: string;
    entitlementId: string;
    version: number;
    contentHash: string;
  }>;
}

export class ProjectEntitlementService {
  readonly #idempotency = new Map<
    string,
    Readonly<{ requestHash: string; result: ProjectEntitlementChangeResult }>
  >();
  readonly #locks = new Map<string, Promise<void>>();

  constructor(private readonly repository: EntitlementRepositoryPort) {}

  async recomputeAuthorizationWitness(
    scope: ProjectScope,
    principalId: string,
    permission: string,
    at: Date,
  ): Promise<ProjectAuthorizationWitness> {
    if (!this.repository.currentAuthorizationWitness)
      throw new Error("PROJECT_AUTHORIZATION_WITNESS_UNAVAILABLE");
    return this.repository.currentAuthorizationWitness(scope, principalId, permission, at);
  }

  async change(input: ProjectEntitlementChange): Promise<ProjectEntitlementChangeResult> {
    const lockKey = `${input.workspaceId}:${input.projectId}:${input.entitlementId}`;
    const prior = this.#locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    this.#locks.set(lockKey, tail);
    await prior;
    try {
      const idempotencyKey = `${lockKey}:${input.idempotencyKey}`;
      const requestHash = onboardingContentHash(input as never);
      const replay = this.#idempotency.get(idempotencyKey);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new Error("PROJECT_ENTITLEMENT_IDEMPOTENCY_CONFLICT");
        return Object.freeze({ ...replay.result, replayed: true });
      }
      const before = await this.repository.current(input, input.entitlementId);
      const currentVersion = before?.version ?? 0;
      if (input.expectedVersion !== currentVersion)
        throw new Error("PROJECT_ENTITLEMENT_VERSION_CONFLICT");
      if ((input.operation === "GRANT") !== (before === undefined))
        throw new Error("PROJECT_ENTITLEMENT_OPERATION_INVALID");
      const version = currentVersion + 1;
      const revision = createProjectEntitlementRevision({
        revisionId: `${input.entitlementId}-r${version}`,
        entitlementId: input.entitlementId,
        version,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        principalId: input.principalId,
        operation: input.operation,
        effect: input.effect,
        permissions: input.permissions,
        classificationCeilingKey: input.classificationCeilingKey,
        validFrom: input.validFrom,
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
        ...(input.revokedAt ? { revokedAt: input.revokedAt } : {}),
        ...(before
          ? {
              previousRevisionRef: {
                id: before.revisionId,
                version: before.version,
                contentHash: before.contentHash,
              },
            }
          : {}),
        actor: input.actor,
        reason: input.reason,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
      });
      await this.repository.append(revision);
      const audit = Object.freeze({
        action: "PROJECT_ENTITLEMENT_CHANGED" as const,
        ...(before ? { before } : {}),
        after: revision,
        correlationId: input.correlationId,
      });
      const result = Object.freeze({
        revision,
        replayed: false,
        audit,
        event: Object.freeze({
          type: "PROJECT_ENTITLEMENTS_CHANGED" as const,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          entitlementId: input.entitlementId,
          version,
          contentHash: revision.contentHash,
        }),
      });
      this.#idempotency.set(idempotencyKey, Object.freeze({ requestHash, result }));
      return result;
    } finally {
      release();
      if (this.#locks.get(lockKey) === tail) this.#locks.delete(lockKey);
    }
  }
}
