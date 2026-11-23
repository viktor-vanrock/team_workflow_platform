import { qaAggregateSnapshotHash, QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaTestAccountLease } from "../domain/project-resources.ts";

export interface TestAccountLeaseAudit {
  readonly authorizationBasis?: unknown;
  readonly action: "LEASE_ACQUIRED" | "LEASE_RELEASED" | "LEASE_EXPIRED" | "LEASE_REVOKED";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly leaseId: string;
  readonly version: number;
  readonly actor: unknown;
  readonly occurredAt: string;
  readonly reasonCode: string;
}

const leaseKey = (scope: QaScope, leaseId: string) =>
  `${scope.workspaceId}:${scope.projectId}:${leaseId}`;
const slotKey = (scope: QaScope, poolId: string, opaqueAccountRef: string) =>
  `${scope.workspaceId}:${scope.projectId}:${poolId}:${opaqueAccountRef}`;

export interface TestAccountLeaseStorePort {
  current(
    scope: QaScope,
    leaseId: string,
  ): QaTestAccountLease | undefined | Promise<QaTestAccountLease | undefined>;
  activeSlot(
    scope: QaScope,
    poolId: string,
    opaqueAccountRef: string,
  ): QaTestAccountLease | undefined | Promise<QaTestAccountLease | undefined>;
  active(scope: QaScope): readonly QaTestAccountLease[] | Promise<readonly QaTestAccountLease[]>;
  append(lease: QaTestAccountLease, audit: TestAccountLeaseAudit): void | Promise<void>;
}

export class InMemoryTestAccountLeaseStore implements TestAccountLeaseStorePort {
  readonly #histories = new Map<string, QaTestAccountLease[]>();
  readonly #activeSlots = new Map<string, string>();
  readonly #audit: TestAccountLeaseAudit[] = [];

  current(scope: QaScope, leaseId: string): QaTestAccountLease | undefined {
    return structuredClone(this.#histories.get(leaseKey(scope, leaseId))?.at(-1));
  }

  activeSlot(
    scope: QaScope,
    poolId: string,
    opaqueAccountRef: string,
  ): QaTestAccountLease | undefined {
    const id = this.#activeSlots.get(slotKey(scope, poolId, opaqueAccountRef));
    return id ? this.current(scope, id) : undefined;
  }

  active(scope: QaScope): readonly QaTestAccountLease[] {
    return [...this.#histories.values()]
      .map((history) => history.at(-1))
      .filter(
        (lease): lease is QaTestAccountLease =>
          lease?.state === "ACTIVE" &&
          lease.workspaceId === scope.workspaceId &&
          lease.projectId === scope.projectId,
      )
      .map((lease) => structuredClone(lease));
  }

  append(lease: QaTestAccountLease, audit: TestAccountLeaseAudit): void {
    const key = leaseKey(lease, lease.leaseId);
    const history = this.#histories.get(key) ?? [];
    if (lease.version !== history.length + 1)
      throw new QaDomainError("QA_ACCOUNT_LEASE_VERSION_CONFLICT");
    if (lease.state === "ACTIVE") {
      const activeKey = slotKey(lease, lease.poolRef.id, lease.opaqueAccountRef);
      const holder = this.#activeSlots.get(activeKey);
      if (holder && holder !== lease.leaseId)
        throw new QaDomainError("ACCOUNT_SLOT_ALREADY_LEASED");
      this.#activeSlots.set(activeKey, lease.leaseId);
    } else {
      this.#activeSlots.delete(slotKey(lease, lease.poolRef.id, lease.opaqueAccountRef));
    }
    this.#histories.set(key, [...history, structuredClone(lease)]);
    this.#audit.push(structuredClone(audit));
  }

  audit(): readonly TestAccountLeaseAudit[] {
    return structuredClone(this.#audit);
  }
}

export interface AcquireTestAccountLeaseInput extends QaScope {
  readonly schemaVersion?: 1;
  readonly leaseId: string;
  readonly poolRef: QaTestAccountLease["poolRef"];
  readonly environmentRef: QaTestAccountLease["environmentRef"];
  readonly subject: QaTestAccountLease["subject"];
  readonly leasedToPrincipalId: string;
  readonly opaqueAccountRef: string;
  readonly maximumLeaseDurationSeconds: number;
  readonly requestedDurationSeconds: number;
  readonly createdBy: QaTestAccountLease["createdBy"];
  readonly now: string;
}

function hashLease(input: Omit<QaTestAccountLease, "contentHash">): QaTestAccountLease {
  return Object.freeze({ ...input, contentHash: qaAggregateSnapshotHash(input as never) });
}

export class ManageTestAccountLease {
  constructor(private readonly store: TestAccountLeaseStorePort) {}

  async acquire(input: AcquireTestAccountLeaseInput): Promise<QaTestAccountLease> {
    const started = Date.parse(input.now);
    if (
      !input.leaseId ||
      !input.opaqueAccountRef ||
      Number.isNaN(started) ||
      input.requestedDurationSeconds < 1 ||
      input.requestedDurationSeconds > input.maximumLeaseDurationSeconds ||
      input.maximumLeaseDurationSeconds > 604_800
    ) {
      throw new QaDomainError("QA_ACCOUNT_LEASE_INVALID");
    }
    if (await this.store.activeSlot(input, input.poolRef.id, input.opaqueAccountRef))
      throw new QaDomainError("ACCOUNT_SLOT_ALREADY_LEASED");
    const expiresAt = new Date(started + input.requestedDurationSeconds * 1_000).toISOString();
    const lease = hashLease({
      ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}),
      leaseId: input.leaseId,
      version: 1,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      poolRef: input.poolRef,
      environmentRef: input.environmentRef,
      subject: input.subject,
      leasedToPrincipalId: input.leasedToPrincipalId,
      opaqueAccountRef: input.opaqueAccountRef,
      state: "ACTIVE",
      acquiredAt: input.now,
      expiresAt,
      createdBy: input.createdBy,
      resourceVersion: 1,
    });
    await this.store.append(lease, {
      action: "LEASE_ACQUIRED",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}),
      leaseId: input.leaseId,
      version: 1,
      actor: input.createdBy,
      occurredAt: input.now,
      reasonCode: "LEASE_GRANTED",
    });
    return lease;
  }

  async release(
    input: Readonly<{
      scope: QaScope;
      leaseId: string;
      actor: unknown;
      now: string;
      reasonCode: string;
    }>,
  ): Promise<QaTestAccountLease> {
    return this.transition(
      input.scope,
      input.leaseId,
      "RELEASED",
      input.actor,
      input.now,
      input.reasonCode,
    );
  }

  async expire(scope: QaScope, now: string): Promise<readonly QaTestAccountLease[]> {
    const timestamp = Date.parse(now);
    const expired: QaTestAccountLease[] = [];
    for (const lease of await this.store.active(scope)) {
      if (Date.parse(lease.expiresAt) <= timestamp) {
        expired.push(
          await this.transition(
            scope,
            lease.leaseId,
            "EXPIRED",
            { kind: "SERVICE", serviceKey: "account-lease-expiry" },
            now,
            "LEASE_TTL_ELAPSED",
          ),
        );
      }
    }
    return Object.freeze(expired);
  }

  private async transition(
    scope: QaScope,
    leaseId: string,
    state: "RELEASED" | "EXPIRED" | "REVOKED",
    actor: unknown,
    now: string,
    reasonCode: string,
  ): Promise<QaTestAccountLease> {
    const before = await this.store.current(scope, leaseId);
    if (!before || before.state !== "ACTIVE")
      throw new QaDomainError("QA_ACCOUNT_LEASE_NOT_ACTIVE");
    const { contentHash: _previousContentHash, ...previous } = before;
    void _previousContentHash;
    const body: Omit<QaTestAccountLease, "contentHash"> = {
      ...previous,
      version: before.version + 1,
      state,
      resourceVersion: before.resourceVersion + 1,
      reasonCode,
      ...(state === "RELEASED" ? { releasedAt: now } : {}),
      ...(state === "REVOKED" ? { revokedAt: now } : {}),
    };
    const lease = hashLease(body);
    const action =
      state === "RELEASED"
        ? "LEASE_RELEASED"
        : state === "EXPIRED"
          ? "LEASE_EXPIRED"
          : "LEASE_REVOKED";
    await this.store.append(lease, {
      action,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      leaseId,
      version: lease.version,
      actor,
      occurredAt: now,
      reasonCode,
    });
    return lease;
  }
}
