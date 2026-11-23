import type { DataSource, EntityManager } from "typeorm";

import type {
  TestAccountLeaseAudit,
  TestAccountLeaseStorePort,
} from "../application/manage-test-account-lease.ts";
import type { QaProjectEffectGuardPort } from "../application/session-start-guards.ts";
import type { QaScope } from "../domain/primitives.ts";
import type { QaTestAccountLease } from "../domain/project-resources.ts";

export class TestAccountLeaseRepository implements TestAccountLeaseStorePort {
  constructor(
    private readonly source: DataSource,
    private readonly effectGuard?: QaProjectEffectGuardPort,
  ) {}

  async activeSlot(
    scope: QaScope,
    poolId: string,
    opaqueAccountRef: string,
  ): Promise<QaTestAccountLease | undefined> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM qa_test_account_lease_heads h
       JOIN qa_test_account_leases r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.lease_id=h.lease_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.pool_id=$3 AND h.opaque_account_ref=$4
        AND h.state='ACTIVE' AND h.expires_at>clock_timestamp()`,
      [scope.workspaceId, scope.projectId, poolId, opaqueAccountRef],
    )) as readonly { semantic_body: QaTestAccountLease }[];
    return rows[0]?.semantic_body;
  }

  async current(scope: QaScope, leaseId: string): Promise<QaTestAccountLease | undefined> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM qa_test_account_lease_heads h
       JOIN qa_test_account_leases r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.lease_id=h.lease_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.lease_id=$3`,
      [scope.workspaceId, scope.projectId, leaseId],
    )) as readonly { semantic_body: QaTestAccountLease }[];
    return rows[0]?.semantic_body;
  }

  async active(scope: QaScope): Promise<readonly QaTestAccountLease[]> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM qa_test_account_lease_heads h
       JOIN qa_test_account_leases r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.lease_id=h.lease_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.state='ACTIVE'`,
      [scope.workspaceId, scope.projectId],
    )) as readonly { semantic_body: QaTestAccountLease }[];
    return rows.map(({ semantic_body }) => semantic_body);
  }

  async append(lease: QaTestAccountLease, audit: TestAccountLeaseAudit): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) =>
      this.appendInTransaction(manager, lease, audit),
    );
  }

  async appendInTransaction(
    manager: EntityManager,
    lease: QaTestAccountLease,
    audit: TestAccountLeaseAudit,
  ): Promise<void> {
    if (!audit.authorizationBasis) throw new Error("QA_ACCOUNT_LEASE_AUTHORIZATION_BASIS_REQUIRED");
    if (lease.version === 1) {
      if (lease.state !== "ACTIVE") throw new Error("QA_ACCOUNT_LEASE_INITIAL_STATE_INVALID");
      await this.effectGuard?.assertEffectsAllowed({
        workspaceId: lease.workspaceId,
        projectId: lease.projectId,
      });
      await manager.query(
        `INSERT INTO qa_test_account_lease_heads(lease_id,workspace_id,project_id,current_version,pool_id,pool_version,opaque_account_ref,state,expires_at,row_version)
         VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,1)`,
        [
          lease.leaseId,
          lease.workspaceId,
          lease.projectId,
          lease.poolRef.id,
          lease.poolRef.version,
          lease.opaqueAccountRef,
          lease.state,
          lease.expiresAt,
        ],
      );
    } else {
      const updated = (await manager.query(
        `UPDATE qa_test_account_lease_heads SET current_version=$4,state=$5,expires_at=$6,row_version=row_version+1
         WHERE workspace_id=$1 AND project_id=$2 AND lease_id=$3 AND current_version=$7 RETURNING current_version`,
        [
          lease.workspaceId,
          lease.projectId,
          lease.leaseId,
          lease.version,
          lease.state,
          lease.expiresAt,
          lease.version - 1,
        ],
      )) as readonly unknown[];
      if (updated.length === 0) throw new Error("QA_ACCOUNT_LEASE_VERSION_CONFLICT");
    }
    await manager.query(
      `INSERT INTO qa_test_account_leases(lease_id,version,workspace_id,project_id,pool_id,pool_version,environment_ref,subject,leased_to_principal_id,opaque_account_ref,state,acquired_at,expires_at,released_at,revoked_at,reason_code,created_by,resource_version,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        lease.leaseId,
        lease.version,
        lease.workspaceId,
        lease.projectId,
        lease.poolRef.id,
        lease.poolRef.version,
        JSON.stringify(lease.environmentRef),
        JSON.stringify(lease.subject),
        lease.leasedToPrincipalId,
        lease.opaqueAccountRef,
        lease.state,
        lease.acquiredAt,
        lease.expiresAt,
        lease.releasedAt ?? null,
        lease.revokedAt ?? null,
        lease.reasonCode ?? null,
        JSON.stringify(lease.createdBy),
        lease.resourceVersion,
        JSON.stringify(lease),
        lease.contentHash,
      ],
    );
    await manager.query(
      `INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,classification_key,attributes,authorization_basis)
       VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,'SUCCEEDED',$6,gen_random_uuid(),gen_random_uuid(),'INTERNAL',$7,$8)`,
      [
        audit.workspaceId,
        audit.projectId,
        audit.occurredAt,
        JSON.stringify(audit.actor),
        audit.action,
        audit.reasonCode,
        JSON.stringify({ leaseId: audit.leaseId, version: audit.version }),
        JSON.stringify(audit.authorizationBasis),
      ],
    );
  }
}
