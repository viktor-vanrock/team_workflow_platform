import { randomUUID } from "node:crypto";

import {
  defaultClassificationCatalog,
  pilotContentHash,
  type AuthorizationBasisRef,
  type ActorReference,
  type PilotRecord,
  type ProjectScope,
  validateAuthorizationBasis,
} from "@awp/platform-core";
import { PilotRepository } from "@awp/platform-persistence-typeorm";
import type { DataSource } from "typeorm";

export interface PilotFenceRevocationAuthority extends ProjectScope {
  authorize(permission: "project.suspend"): Promise<
    Readonly<{
      actor: ActorReference;
      basis: AuthorizationBasisRef;
      classificationCeiling: string;
      stepUpAt: string;
    }>
  >;
}

/** Only closes an existing fence; this service cannot enable or broaden external writes. */
export class DurablePilotFenceRevocation {
  constructor(
    private readonly source: DataSource,
    private readonly clock = () => Date.now(),
  ) {}

  async revoke(
    authority: PilotFenceRevocationAuthority,
    expected: Readonly<{
      id: string;
      version: number;
      contentHash: string;
    }>,
  ) {
    const initial = await this.authorize(authority);
    if (
      !expected.id ||
      !Number.isSafeInteger(expected.version) ||
      expected.version < 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(expected.contentHash)
    )
      throw new Error("PILOT_FENCE_REVOKE_INVALID");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const scope = { workspaceId: authority.workspaceId, projectId: authority.projectId };
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `pilot:${scope.workspaceId}:${scope.projectId}:${expected.id}`,
      ]);
      const rows = (await manager.query(
        `SELECT r.semantic_body,r.content_hash,h.row_version FROM pilot_record_headers h
         JOIN pilot_record_revisions r ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=
           (h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
         WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.record_id=$3 AND h.kind='FENCE' FOR UPDATE OF h`,
        [scope.workspaceId, scope.projectId, expected.id],
      )) as {
        semantic_body: Omit<PilotRecord, "contentHash">;
        content_hash: string;
        row_version: string | number;
      }[];
      const row = rows[0];
      if (
        !row ||
        rows.length !== 1 ||
        row.semantic_body.id !== expected.id ||
        row.semantic_body.workspaceId !== scope.workspaceId ||
        row.semantic_body.projectId !== scope.projectId ||
        row.semantic_body.kind !== "FENCE" ||
        row.semantic_body.version !== expected.version ||
        row.content_hash !== expected.contentHash ||
        pilotContentHash(row.semantic_body) !== row.content_hash ||
        row.semantic_body.body.schemaVersion !== 1 ||
        typeof row.semantic_body.body.revoked !== "boolean"
      )
        throw new Error("PILOT_FENCE_VERSION_CONFLICT");
      const current = await this.authorize(authority);
      if (
        pilotContentHash(initial.actor) !== pilotContentHash(current.actor) ||
        pilotContentHash(initial.basis) !== pilotContentHash(current.basis)
      )
        throw new Error("PILOT_FENCE_REVOKE_DENIED");
      if (row.semantic_body.body.revoked === true) return { ...expected, replayed: true };
      const correlationId = randomUUID(),
        causationId = randomUUID();
      const body = {
        ...row.semantic_body,
        version: expected.version + 1,
        actorRef: current.actor.principalId,
        correlationId,
        createdAt: new Date(this.clock()).toISOString(),
        body: { ...row.semantic_body.body, revoked: true },
      };
      const record: PilotRecord = { ...body, contentHash: pilotContentHash(body) };
      await new PilotRepository(this.source).publish(record, Number(row.row_version), manager);
      await manager.query(
        `INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,
         correlation_id,causation_id,authorization_basis,classification_key,attributes)
         VALUES($1,$2,$3,clock_timestamp(),$4,'pilot.fence.revoke','SUCCEEDED','PILOT_FENCE_REVOKED',$5,$6,$7,'CONFIDENTIAL',$8)`,
        [
          randomUUID(),
          scope.workspaceId,
          scope.projectId,
          current.actor,
          correlationId,
          causationId,
          current.basis,
          { values: { fenceId: record.id, version: record.version }, versionRefs: [expected] },
        ],
      );
      return {
        id: record.id,
        version: record.version,
        contentHash: record.contentHash,
        replayed: false,
      };
    });
  }

  private async authorize(authority: PilotFenceRevocationAuthority) {
    const value = await authority.authorize("project.suspend");
    const stepUp = Date.parse(value.stepUpAt);
    if (
      !authority.workspaceId ||
      !authority.projectId ||
      value.actor.kind !== "HUMAN" ||
      !value.actor.principalId ||
      !value.actor.issuer ||
      !value.actor.subject ||
      !Number.isFinite(stepUp) ||
      stepUp > this.clock() ||
      this.clock() - stepUp > 300_000 ||
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(value.classificationCeiling),
        defaultClassificationCatalog.reference("CONFIDENTIAL"),
      )
    )
      throw new Error("PILOT_FENCE_REVOKE_DENIED");
    validateAuthorizationBasis(
      { kind: "PROJECT", workspaceId: authority.workspaceId, projectId: authority.projectId },
      value.basis,
    );
    return value;
  }
}
