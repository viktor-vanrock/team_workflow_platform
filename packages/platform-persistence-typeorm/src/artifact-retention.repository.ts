import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  assertExactRevisionRef,
  assertProjectScope,
  type ExactRevisionRef,
  onboardingContentHash,
  type ProjectScope,
} from "@awp/platform-core";

export interface ArtifactAvailabilityRevision extends ProjectScope {
  readonly availabilityRevisionId: string;
  readonly artifactId: string;
  readonly version: number;
  readonly state: "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";
  readonly contentHash: string;
}

export interface ArtifactRetentionDecision extends ProjectScope {
  readonly decisionId: string;
  readonly version: 1;
  readonly artifactId: string;
  readonly retentionPolicyRef: ExactRevisionRef;
  readonly legalHoldRef?: ExactRevisionRef;
  readonly decision: "RETAIN" | "EXPIRE" | "QUARANTINE";
  readonly eligibleAt: string;
  readonly effectiveAt?: string;
  readonly ownerPrincipalId: string;
  readonly reasonCode: string;
  readonly createdAt: string;
  readonly contentHash: `sha256:${string}`;
}

export interface DueArtifactExpiration extends ProjectScope {
  readonly artifactId: string;
  readonly decisionRef: ExactRevisionRef;
}

function validTime(now: string): void {
  if (!Number.isFinite(Date.parse(now))) throw new Error("RETENTION_QUERY_INVALID");
}

function validateDecision(value: ArtifactRetentionDecision): void {
  assertProjectScope(value);
  assertExactRevisionRef(value.retentionPolicyRef);
  if (value.legalHoldRef) assertExactRevisionRef(value.legalHoldRef);
  const { contentHash, ...body } = value;
  if (
    !value.decisionId ||
    !value.artifactId ||
    !value.ownerPrincipalId ||
    value.version !== 1 ||
    !["RETAIN", "EXPIRE", "QUARANTINE"].includes(value.decision) ||
    !/^[A-Z][A-Z0-9_]{0,95}$/u.test(value.reasonCode) ||
    !Number.isFinite(Date.parse(value.eligibleAt)) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    (value.effectiveAt !== undefined &&
      (!Number.isFinite(Date.parse(value.effectiveAt)) ||
        Date.parse(value.effectiveAt) < Date.parse(value.eligibleAt))) ||
    (value.decision === "EXPIRE" && value.legalHoldRef !== undefined) ||
    onboardingContentHash(body as never) !== contentHash
  )
    throw new Error("RETENTION_DECISION_INVALID");
}

export class ArtifactRetentionRepository {
  constructor(private readonly source: DataSource) {}

  /** Trusted command boundary supplies an already-authorized immutable decision. */
  async appendDecision(input: ArtifactRetentionDecision): Promise<void> {
    const value = structuredClone(input);
    validateDecision(value);
    await this.source.transaction("READ COMMITTED", async (manager) => {
      // Decisions (including legal holds) and workers share the artifact lock.
      const artifacts = (await manager.query(
        "SELECT id FROM artifact_references WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [value.workspaceId, value.projectId, value.artifactId],
      )) as unknown[];
      if (artifacts.length !== 1) throw new Error("ARTIFACT_NOT_FOUND");
      const existing = (await manager.query(
        "SELECT content_hash FROM artifact_retention_decisions WHERE decision_id=$1",
        [value.decisionId],
      )) as { content_hash: string }[];
      if (existing[0]) {
        if (existing[0].content_hash !== value.contentHash)
          throw new Error("RETENTION_DECISION_CONFLICT");
        return;
      }
      await manager.query(
        `INSERT INTO artifact_retention_decisions(decision_id,version,workspace_id,project_id,artifact_id,retention_policy_ref,legal_hold_ref,decision,eligible_at,effective_at,owner_principal_id,reason_code,created_at,semantic_body,content_hash)
        VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          value.decisionId,
          value.workspaceId,
          value.projectId,
          value.artifactId,
          JSON.stringify(value.retentionPolicyRef),
          value.legalHoldRef ? JSON.stringify(value.legalHoldRef) : null,
          value.decision,
          value.eligibleAt,
          value.effectiveAt ?? null,
          value.ownerPrincipalId,
          value.reasonCode,
          value.createdAt,
          JSON.stringify(value),
          value.contentHash,
        ],
      );
    });
  }

  /** Internal scheduler only: every result carries its scope and exact decision. */
  async dueExpirations(
    now: string,
    limit = 100,
    scope?: Readonly<{ workspaceId: string; projectIds: readonly string[] }>,
  ): Promise<readonly DueArtifactExpiration[]> {
    validTime(now);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("RETENTION_QUERY_INVALID");
    if (scope && (!scope.workspaceId || !scope.projectIds.length))
      throw new Error("RETENTION_SCOPE_INVALID");
    const rows = (await this.source.query(
      `SELECT a.workspace_id,a.project_id,a.id,d.decision_id,d.content_hash
      FROM artifact_references a
      LEFT JOIN artifact_availability_heads h ON h.workspace_id=a.workspace_id AND h.project_id=a.project_id AND h.artifact_id=a.id
      JOIN LATERAL (
        SELECT * FROM artifact_retention_decisions d
        WHERE d.workspace_id=a.workspace_id AND d.project_id=a.project_id AND d.artifact_id=a.id AND d.created_at<=$1
        ORDER BY d.created_at DESC,(d.legal_hold_ref IS NOT NULL) DESC,d.decision_id DESC LIMIT 1
      ) d ON true
      WHERE a.availability='AVAILABLE' AND (h.artifact_id IS NULL OR h.current_state='AVAILABLE')
        AND ($3::uuid IS NULL OR (a.workspace_id=$3 AND a.project_id=ANY($4::uuid[])))
        AND d.decision='EXPIRE' AND d.legal_hold_ref IS NULL AND d.eligible_at<=$1
        AND (d.effective_at IS NULL OR d.effective_at<=$1)
      ORDER BY d.eligible_at,a.workspace_id,a.project_id,a.id LIMIT $2`,
      [now, limit, scope?.workspaceId ?? null, scope ? [...scope.projectIds] : null],
    )) as {
      workspace_id: string;
      project_id: string;
      id: string;
      decision_id: string;
      content_hash: `sha256:${string}`;
    }[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          artifactId: row.id,
          decisionRef: Object.freeze({
            id: row.decision_id,
            version: 1,
            contentHash: row.content_hash,
          }),
        }),
      ),
    );
  }

  async expireDue(input: DueArtifactExpiration, now: string): Promise<boolean> {
    const candidate = structuredClone(input);
    assertProjectScope(candidate);
    assertExactRevisionRef(candidate.decisionRef);
    validTime(now);
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const params = [candidate.workspaceId, candidate.projectId, candidate.artifactId];
      const artifacts = (await manager.query(
        `SELECT availability,checksum,object_version_or_etag,created_at
        FROM artifact_references WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE`,
        params,
      )) as {
        availability: string;
        checksum: string;
        object_version_or_etag: string;
        created_at: Date;
      }[];
      const artifact = artifacts[0];
      if (!artifact || artifact.availability !== "AVAILABLE") return false;
      const decisions = (await manager.query(
        `SELECT semantic_body FROM artifact_retention_decisions
        WHERE workspace_id=$1 AND project_id=$2 AND artifact_id=$3 AND created_at<=$4
        ORDER BY created_at DESC,(legal_hold_ref IS NOT NULL) DESC,decision_id DESC LIMIT 1`,
        [...params, now],
      )) as { semantic_body: ArtifactRetentionDecision }[];
      const decision = decisions[0]?.semantic_body;
      if (!decision) return false;
      validateDecision(decision);
      if (
        decision.workspaceId !== candidate.workspaceId ||
        decision.projectId !== candidate.projectId ||
        decision.artifactId !== candidate.artifactId ||
        decision.decisionId !== candidate.decisionRef.id ||
        decision.version !== candidate.decisionRef.version ||
        decision.contentHash !== candidate.decisionRef.contentHash ||
        decision.decision !== "EXPIRE" ||
        decision.legalHoldRef ||
        Date.parse(decision.eligibleAt) > Date.parse(now) ||
        (decision.effectiveAt && Date.parse(decision.effectiveAt) > Date.parse(now))
      )
        return false;
      const heads = (await manager.query(
        `SELECT h.current_version,h.current_state,r.availability_revision_id,r.content_hash
        FROM artifact_availability_heads h JOIN artifact_availability_revisions r
          ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.artifact_id=h.artifact_id AND r.version=h.current_version
        WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.artifact_id=$3 FOR UPDATE OF h`,
        params,
      )) as {
        current_version: number;
        current_state: string;
        availability_revision_id: string;
        content_hash: `sha256:${string}`;
      }[];
      let head = heads[0];
      if (head && head.current_state !== "AVAILABLE") return false;
      if (!head) {
        // Artifacts registered after migration 0160 may not yet have a ledger.
        const initial = {
          availabilityRevisionId: randomUUID(),
          ...candidateScope(candidate),
          artifactId: candidate.artifactId,
          version: 1,
          state: "AVAILABLE",
          reasonCode: "REGISTERED_ARTIFACT_OBSERVED",
          observedChecksum: artifact.checksum,
          observedObjectVersionOrEtag: artifact.object_version_or_etag,
          observedAt: artifact.created_at.toISOString(),
          source: "PROVIDER",
        };
        const initialHash = onboardingContentHash(initial as never);
        await manager.query(
          "INSERT INTO artifact_availability_heads(artifact_id,workspace_id,project_id,current_version,current_state) VALUES($3,$1,$2,1,'AVAILABLE')",
          params,
        );
        await manager.query(
          `INSERT INTO artifact_availability_revisions(availability_revision_id,workspace_id,project_id,artifact_id,version,state,reason_code,observed_checksum,observed_object_version_or_etag,observed_at,source,semantic_body,content_hash)
          VALUES($1,$2,$3,$4,1,'AVAILABLE',$5,$6,$7,$8,'PROVIDER',$9,$10)`,
          [
            initial.availabilityRevisionId,
            candidate.workspaceId,
            candidate.projectId,
            candidate.artifactId,
            initial.reasonCode,
            artifact.checksum,
            artifact.object_version_or_etag,
            initial.observedAt,
            JSON.stringify({ ...initial, contentHash: initialHash }),
            initialHash,
          ],
        );
        head = {
          current_version: 1,
          current_state: "AVAILABLE",
          availability_revision_id: initial.availabilityRevisionId,
          content_hash: initialHash,
        };
      }
      const body = {
        availabilityRevisionId: randomUUID(),
        ...candidateScope(candidate),
        artifactId: candidate.artifactId,
        version: head.current_version + 1,
        state: "EXPIRED",
        reasonCode: "RETENTION_POLICY_APPLIED",
        observedChecksum: artifact.checksum,
        observedAt: now,
        source: "RETENTION_WORKER",
        previousRevisionRef: {
          id: head.availability_revision_id,
          version: head.current_version,
          contentHash: head.content_hash,
        },
        retentionDecisionRef: candidate.decisionRef,
      };
      const hash = onboardingContentHash(body as never);
      await manager.query(
        `INSERT INTO artifact_availability_revisions(availability_revision_id,workspace_id,project_id,artifact_id,version,state,reason_code,observed_checksum,observed_at,source,previous_revision_id,previous_version,previous_content_hash,semantic_body,content_hash)
        VALUES($1,$2,$3,$4,$5,'EXPIRED','RETENTION_POLICY_APPLIED',$6,$7,'RETENTION_WORKER',$8,$9,$10,$11,$12)`,
        [
          body.availabilityRevisionId,
          candidate.workspaceId,
          candidate.projectId,
          candidate.artifactId,
          body.version,
          artifact.checksum,
          now,
          head.availability_revision_id,
          head.current_version,
          head.content_hash,
          JSON.stringify({ ...body, contentHash: hash }),
          hash,
        ],
      );
      await manager.query(
        "UPDATE artifact_availability_heads SET current_version=$4,current_state='EXPIRED',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND artifact_id=$3",
        [...params, body.version],
      );
      await manager.query(
        "UPDATE artifact_references SET availability='EXPIRED' WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        params,
      );
      return true;
    });
  }

  async currentAvailability(
    scope: ProjectScope,
    artifactId: string,
  ): Promise<ArtifactAvailabilityRevision | undefined> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM artifact_availability_heads h
       JOIN artifact_availability_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id
        AND r.artifact_id=h.artifact_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.artifact_id=$3`,
      [scope.workspaceId, scope.projectId, artifactId],
    )) as readonly { semantic_body: ArtifactAvailabilityRevision }[];
    return rows[0]?.semantic_body;
  }

  async appendAvailability(
    revision: ArtifactAvailabilityRevision,
    expectedVersion: number,
  ): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        `SELECT h.current_version,r.availability_revision_id,r.content_hash
        FROM artifact_availability_heads h JOIN artifact_availability_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.artifact_id=h.artifact_id AND r.version=h.current_version
        WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.artifact_id=$3 FOR UPDATE`,
        [revision.workspaceId, revision.projectId, revision.artifactId],
      )) as readonly Readonly<{
        current_version: number | string;
        availability_revision_id: string;
        content_hash: string;
      }>[];
      const current = Number(rows[0]?.current_version ?? 0);
      if (current !== expectedVersion || revision.version !== current + 1)
        throw new Error("ARTIFACT_AVAILABILITY_VERSION_CONFLICT");
      const prior = rows[0]!;
      await manager.query(
        `INSERT INTO artifact_availability_revisions(availability_revision_id,artifact_id,version,workspace_id,project_id,state,reason_code,observed_object_version_or_etag,observed_checksum,observed_at,source,previous_revision_id,previous_version,previous_content_hash,semantic_body,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,'RETENTION_POLICY_APPLIED',NULL,NULL,clock_timestamp(),'RETENTION_WORKER',$7,$8,$9,$10,$11)`,
        [
          revision.availabilityRevisionId,
          revision.artifactId,
          revision.version,
          revision.workspaceId,
          revision.projectId,
          revision.state,
          prior.availability_revision_id,
          current,
          prior.content_hash,
          JSON.stringify(revision),
          revision.contentHash,
        ],
      );
      const updated = (await manager.query(
        "UPDATE artifact_availability_heads SET current_version=$4,current_state=$5,row_version=row_version+1 WHERE artifact_id=$1 AND workspace_id=$2 AND project_id=$3 AND current_version=$6 RETURNING artifact_id",
        [
          revision.artifactId,
          revision.workspaceId,
          revision.projectId,
          revision.version,
          revision.state,
          current,
        ],
      )) as readonly unknown[];
      if (updated.length !== 1) throw new Error("ARTIFACT_AVAILABILITY_VERSION_CONFLICT");
    });
  }
}

function candidateScope(value: ProjectScope): ProjectScope {
  return { workspaceId: value.workspaceId, projectId: value.projectId };
}
