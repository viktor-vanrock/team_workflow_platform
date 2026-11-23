import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  authorizedProjectSetHash,
  type CapacityAccountingSnapshot,
  createCapacitySnapshot,
  type PublicCapacitySnapshot,
  type ResourceScope,
  validateCapacitySnapshot,
} from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const stablePublicStateHash = (value: PublicCapacitySnapshot): string => {
  const {
    authorizedProjectionRef: _ref,
    asOf: _asOf,
    reconciledAt: _reconciledAt,
    ...state
  } = value;
  void _ref;
  void _asOf;
  void _reconciledAt;
  return sha256(state as unknown as JsonValue);
};

export class CapacityScopeProjectionRepository extends ScopedRepositoryBase {
  async currentAuthorizedProjection(
    scope:
      | Extract<ResourceScope, { kind: "PROJECT" }>
      | Readonly<{
          kind: "AUTHORIZED_PORTFOLIO";
          workspaceId: string;
          authorizedProjectSetHash: string;
        }>,
    projectIds: readonly string[],
  ): Promise<Row | undefined> {
    const authorizedIds = Object.freeze([...new Set(projectIds)].sort());
    if (
      authorizedIds.length === 0 ||
      (scope.kind === "PROJECT" &&
        (authorizedIds.length !== 1 || authorizedIds[0] !== scope.projectId))
    ) {
      throw new Error("CAPACITY_PROJECTION_SCOPE_INVALID");
    }
    const authorizedProjectSetHashValue = authorizedProjectSetHash(projectIds);
    if (
      scope.kind === "AUTHORIZED_PORTFOLIO" &&
      scope.authorizedProjectSetHash !== authorizedProjectSetHashValue
    )
      throw new Error("CAPACITY_PROJECTION_SCOPE_HASH_MISMATCH");
    const rows = await this.workspaceRows<Row>(
      { kind: "WORKSPACE", workspaceId: scope.workspaceId },
      scope.kind === "PROJECT"
        ? "SELECT r.safe_body,r.semantic_hash,r.revision_number FROM capacity_scope_projection_heads h JOIN capacity_scope_projection_revisions r ON r.workspace_id=h.workspace_id AND r.capacity_projection_revision_id=h.current_revision_id WHERE h.workspace_id=$1 AND h.scope_kind='PROJECT' AND h.project_id=$2 AND h.authorized_project_set_hash=$3"
        : "SELECT r.safe_body,r.semantic_hash,r.revision_number FROM capacity_scope_projection_heads h JOIN capacity_scope_projection_revisions r ON r.workspace_id=h.workspace_id AND r.capacity_projection_revision_id=h.current_revision_id WHERE h.workspace_id=$1 AND h.scope_kind='AUTHORIZED_PORTFOLIO' AND h.authorized_project_set_hash=$2",
      scope.kind === "PROJECT"
        ? [scope.projectId, authorizedProjectSetHashValue]
        : [authorizedProjectSetHashValue],
    );
    if (!rows[0]) return undefined;
    const safeBody = json<PublicCapacitySnapshot>(rows[0].safe_body);
    validateCapacitySnapshot(safeBody);
    if (
      safeBody.scope.kind !== scope.kind ||
      safeBody.authorizedProjectSetHash !== authorizedProjectSetHashValue ||
      (scope.kind === "PROJECT" &&
        (safeBody.scope.kind !== "PROJECT" || safeBody.scope.projectId !== scope.projectId))
    ) {
      throw new Error("CAPACITY_PROJECTION_STORED_SCOPE_MISMATCH");
    }
    return Object.freeze({ ...rows[0], safe_body: safeBody });
  }

  async projectionMembership(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    capacityProjectionId: string,
  ): Promise<readonly string[]> {
    const rows = await this.workspaceRows<Row>(
      scope,
      'SELECT project_id FROM capacity_scope_projection_projects WHERE workspace_id=$1 AND capacity_projection_id=$2 ORDER BY project_id COLLATE "C"',
      [capacityProjectionId],
    );
    return Object.freeze(rows.map(({ project_id }) => String(project_id)));
  }

  async materializeAuthorizedProjection(
    input: Readonly<{
      workspaceId: string;
      scope: PublicCapacitySnapshot["scope"];
      projectIds: readonly string[];
      capacityProjectionId: string;
      capacityProjectionRevisionId: string;
      policyFacetRef: PublicCapacitySnapshot["policyFacetRef"];
      policyMode: PublicCapacitySnapshot["policyMode"];
      accounting: CapacityAccountingSnapshot;
      workspaceHumanWipLimit?: number;
      activeExpediteLimit?: number;
      sourceCapacityVersion: number;
      freshness: PublicCapacitySnapshot["freshness"];
      asOf: string;
      reconciledAt: string;
    }>,
    executor?: EntityManager,
  ): Promise<
    Readonly<{ outcome: "APPENDED" | "NO_OP_UNCHANGED"; snapshot: PublicCapacitySnapshot }>
  > {
    const projectIds = Object.freeze([...new Set(input.projectIds)].sort());
    if (
      projectIds.length === 0 ||
      input.scope.workspaceId !== input.workspaceId ||
      (input.scope.kind === "PROJECT" &&
        (projectIds.length !== 1 || projectIds[0] !== input.scope.projectId))
    ) {
      throw new Error("CAPACITY_PROJECTION_SCOPE_INVALID");
    }
    const setHash = authorizedProjectSetHash(projectIds);
    const run = async (manager: EntityManager) => {
      await manager.query(
        `INSERT INTO capacity_scope_projection_heads(capacity_projection_id,workspace_id,scope_kind,project_id,authorized_project_set_hash,current_revision_id,resource_version,reconciled_capacity_version,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,NULL,0,0,$6,$6) ON CONFLICT DO NOTHING`,
        [
          input.capacityProjectionId,
          input.workspaceId,
          input.scope.kind,
          input.scope.kind === "PROJECT" ? input.scope.projectId : null,
          setHash,
          input.reconciledAt,
        ],
      );
      const heads = (await manager.query(
        input.scope.kind === "PROJECT"
          ? "SELECT * FROM capacity_scope_projection_heads WHERE workspace_id=$1 AND scope_kind='PROJECT' AND project_id=$2 FOR UPDATE"
          : "SELECT * FROM capacity_scope_projection_heads WHERE workspace_id=$1 AND scope_kind='AUTHORIZED_PORTFOLIO' AND authorized_project_set_hash=$2 FOR UPDATE",
        [input.workspaceId, input.scope.kind === "PROJECT" ? input.scope.projectId : setHash],
      )) as readonly Row[];
      const head = heads[0];
      if (
        !head ||
        String(head.capacity_projection_id) !== input.capacityProjectionId ||
        String(head.authorized_project_set_hash) !== setHash
      )
        throw new Error("CAPACITY_PROJECTION_HEAD_CONFLICT");
      const membership = (await manager.query(
        'SELECT project_id FROM capacity_scope_projection_projects WHERE workspace_id=$1 AND capacity_projection_id=$2 ORDER BY project_id COLLATE "C" FOR SHARE',
        [input.workspaceId, input.capacityProjectionId],
      )) as readonly Row[];
      if (membership.length === 0)
        for (const projectId of projectIds)
          await manager.query(
            "INSERT INTO capacity_scope_projection_projects(workspace_id,capacity_projection_id,project_id) VALUES($1,$2,$3)",
            [input.workspaceId, input.capacityProjectionId, projectId],
          );
      const persisted =
        membership.length === 0
          ? projectIds
          : membership.map(({ project_id }) => String(project_id));
      if (authorizedProjectSetHash(persisted) !== setHash)
        throw new Error("CAPACITY_PROJECTION_MEMBERSHIP_CONFLICT");
      const nextVersion = Number(head.resource_version) + 1;
      const snapshot = createCapacitySnapshot({
        workspaceId: input.workspaceId,
        scope: input.scope,
        authorizedProjectIds: projectIds,
        policyFacetRef: input.policyFacetRef,
        policyMode: input.policyMode,
        authorizedProjectionId: input.capacityProjectionId,
        authorizedProjectionVersion: nextVersion,
        accounting: input.accounting,
        ...(input.workspaceHumanWipLimit !== undefined
          ? { workspaceHumanWipLimit: input.workspaceHumanWipLimit }
          : {}),
        ...(input.activeExpediteLimit !== undefined
          ? { activeExpediteLimit: input.activeExpediteLimit }
          : {}),
        freshness: input.freshness,
        asOf: input.asOf,
        reconciledAt: input.reconciledAt,
      });
      if (head.current_revision_id) {
        const currentRows = (await manager.query(
          "SELECT safe_body,semantic_hash FROM capacity_scope_projection_revisions WHERE workspace_id=$1 AND capacity_projection_revision_id=$2 FOR SHARE",
          [input.workspaceId, head.current_revision_id],
        )) as readonly Row[];
        const current = currentRows[0];
        const currentSnapshot = current
          ? json<PublicCapacitySnapshot>(current.safe_body)
          : undefined;
        if (
          currentSnapshot &&
          stablePublicStateHash(currentSnapshot) === stablePublicStateHash(snapshot)
        ) {
          await manager.query(
            "UPDATE capacity_scope_projection_heads SET reconciled_capacity_version=$3,updated_at=$4 WHERE workspace_id=$1 AND capacity_projection_id=$2",
            [
              input.workspaceId,
              input.capacityProjectionId,
              input.sourceCapacityVersion,
              input.reconciledAt,
            ],
          );
          return Object.freeze({ outcome: "NO_OP_UNCHANGED" as const, snapshot: currentSnapshot });
        }
      }
      await manager.query(
        `INSERT INTO capacity_scope_projection_revisions(capacity_projection_revision_id,capacity_projection_id,workspace_id,revision_number,previous_revision_id,authorized_project_set_hash,policy_facet_ref,human_occupied_count,review_reserved_count,human_committed_count,forced_external_count,active_expedite_count,safe_body,semantic_hash,recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          input.capacityProjectionRevisionId,
          input.capacityProjectionId,
          input.workspaceId,
          nextVersion,
          head.current_revision_id ?? null,
          setHash,
          JSON.stringify(input.policyFacetRef),
          input.accounting.humanOccupiedCount,
          input.accounting.reviewReservedCount,
          input.accounting.humanCommittedCount,
          input.accounting.forcedExternalCount,
          input.accounting.activeExpediteCount,
          JSON.stringify(snapshot),
          snapshot.authorizedProjectionRef.semanticHash,
          input.reconciledAt,
        ],
      );
      const updated = (await manager.query(
        "UPDATE capacity_scope_projection_heads SET current_revision_id=$3,resource_version=resource_version+1,reconciled_capacity_version=$4,updated_at=$5 WHERE workspace_id=$1 AND capacity_projection_id=$2 AND resource_version=$6 RETURNING resource_version",
        [
          input.workspaceId,
          input.capacityProjectionId,
          input.capacityProjectionRevisionId,
          input.sourceCapacityVersion,
          input.reconciledAt,
          Number(head.resource_version),
        ],
      )) as readonly Row[];
      if (!updated[0]) throw new Error("CAPACITY_PROJECTION_CAS_CONFLICT");
      return Object.freeze({ outcome: "APPENDED" as const, snapshot });
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }
}
