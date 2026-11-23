import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  evidenceContentHash,
  type EvidenceSignatureEnvelope,
  type QaEvidenceManifestRevisionV2,
} from "@awp/competency-qa";
import { OfflineSchemaRegistry, type Sha256Digest } from "@awp/platform-contracts";
import type { ExactRevisionRef, ProjectScope } from "@awp/platform-core";

import type { QaApiAuthorization } from "../qa-api-authorization.ts";

export const EVIDENCE_HTTP_APPLICATION = Symbol("EVIDENCE_HTTP_APPLICATION");
export interface EvidenceCrypto {
  signManifest(manifest: QaEvidenceManifestRevisionV2): Promise<EvidenceSignatureEnvelope>;
  verify(
    manifest: QaEvidenceManifestRevisionV2,
    envelope: EvidenceSignatureEnvelope,
  ): Promise<"VALID" | "INVALID" | "KEY_UNAVAILABLE">;
  readonly redactionPolicyRef: ExactRevisionRef;
  readonly exportPolicyRef: ExactRevisionRef;
}
type Authority = () => Promise<QaApiAuthorization>;
type Request = ProjectScope & Readonly<{ authorize: Authority }>;
type Receipt = Readonly<{
  commandId: string;
  state: "COMPLETED";
  resultRef: ExactRevisionRef;
  correlationId: string;
}>;
type Package = Readonly<{
  packageId: string;
  version: number;
  workspaceId: string;
  projectId: string;
  workItemId: string;
  manifestRevisionRefs: readonly ExactRevisionRef[];
  signatureRefs: readonly ExactRevisionRef[];
  contentHash: Sha256Digest;
  [key: string]: unknown;
}>;
type ManifestRow = Readonly<{
  semantic_body: QaEvidenceManifestRevisionV2;
  content_hash: Sha256Digest;
  effective_classification_key: string;
  manifest_revision_id: string;
  manifest_id: string;
  version: number;
  work_item_id: string;
  session_id: string;
}>;
const schemas = new OfflineSchemaRegistry();
const exact = (id: string, version: number, contentHash: Sha256Digest): ExactRevisionRef => ({
  id,
  version,
  contentHash,
});
const sameRef = (a: unknown, b: ExactRevisionRef): boolean =>
  evidenceContentHash(a) === evidenceContentHash(b);
const hashed = (value: Readonly<{ contentHash: string; [key: string]: unknown }>): boolean => {
  const { contentHash, ...body } = value;
  return evidenceContentHash(body) === contentHash;
};

export class EvidenceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const fail = (status: number, code: string): never => {
  throw new EvidenceHttpError(status, code);
};

/** All durable writes, receipts and audit events share the same PostgreSQL transaction. */
export class DurableEvidenceHttpApplication {
  constructor(
    private readonly source: DataSource,
    private readonly crypto: (scope: ProjectScope) => EvidenceCrypto,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private scopedCrypto(scope: ProjectScope): EvidenceCrypto {
    // Ports receive stable scope only, never request callbacks or command fields.
    return this.crypto({ workspaceId: scope.workspaceId, projectId: scope.projectId });
  }

  private async access(request: Request): Promise<QaApiAuthorization> {
    const access = await request.authorize();
    if (
      access.scope.workspaceId !== request.workspaceId ||
      access.scope.projectId !== request.projectId ||
      access.actor.kind !== "HUMAN"
    )
      fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
    return access;
  }
  private async reauthorize(request: Request, previous: QaApiAuthorization) {
    const current = await this.access(request);
    const authorityHash = (value: QaApiAuthorization) =>
      evidenceContentHash({
        actor: value.actor,
        basis: value.basis,
        classificationCeiling: value.classificationCeiling,
      });
    if (authorityHash(current) !== authorityHash(previous))
      fail(403, "EVIDENCE_AUTHORIZATION_CHANGED");
  }
  private async classification(
    manager: EntityManager,
    access: QaApiAuthorization,
    key: string,
  ): Promise<void> {
    const rows = (await manager.query(
      "SELECT 1 FROM classification_catalog resource JOIN classification_catalog ceiling ON ceiling.key=$2 WHERE resource.key=$1 AND resource.rank<=ceiling.rank",
      [key, access.classificationCeiling],
    )) as unknown[];
    if (rows.length !== 1) fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
  }
  private async manifest(
    manager: EntityManager,
    request: Request,
    manifestId: string,
    revision: number,
    access: QaApiAuthorization,
  ): Promise<ManifestRow> {
    const rows = (await manager.query(
      "SELECT * FROM qa_evidence_manifest_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND manifest_id=$3 AND version=$4",
      [request.workspaceId, request.projectId, manifestId, revision],
    )) as ManifestRow[];
    const row = rows[0];
    if (!row) return fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
    await this.classification(manager, access, row.effective_classification_key);
    return row;
  }
  private async verification(
    manager: EntityManager,
    request: Request,
    row: ManifestRow,
    signatureRef?: ExactRevisionRef,
  ) {
    const manifest = row.semantic_body;
    let integrity = false;
    try {
      schemas.validateById("urn:awp:schemas:007:evidence-manifest:v2", manifest);
      integrity =
        hashed(manifest) &&
        manifest.contentHash === row.content_hash &&
        manifest.workspaceId === request.workspaceId &&
        manifest.projectId === request.projectId &&
        manifest.manifestRevisionId === row.manifest_revision_id &&
        manifest.manifestId === row.manifest_id &&
        manifest.version === row.version &&
        manifest.workItemId === row.work_item_id &&
        manifest.sessionId === row.session_id &&
        manifest.effectiveClassificationKey === row.effective_classification_key &&
        evidenceContentHash(manifest.targetSnapshot.value) === manifest.targetSnapshot.contentHash;
    } catch {
      /* Malformed persisted content is a failed proof. */
    }
    const envelopes = (await manager.query(
      "SELECT semantic_body FROM qa_evidence_signature_envelopes WHERE workspace_id=$1 AND project_id=$2 AND manifest_revision_id=$3 ORDER BY signed_at DESC,signature_id",
      [request.workspaceId, request.projectId, row.manifest_revision_id],
    )) as { semantic_body: EvidenceSignatureEnvelope }[];
    const selected = signatureRef
      ? envelopes.filter(
          ({ semantic_body: e }) =>
            e.signatureId === signatureRef.id &&
            e.version === signatureRef.version &&
            e.contentHash === signatureRef.contentHash,
        )
      : envelopes;
    let signature: "VALID" | "INVALID" | "KEY_UNAVAILABLE" = "INVALID";
    for (const { semantic_body: envelope } of selected) {
      try {
        schemas.validateById("urn:awp:schemas:007:evidence-signature-envelope:v1", envelope);
        const result = integrity
          ? await this.scopedCrypto(request).verify(manifest, envelope)
          : "INVALID";
        if (result === "VALID") {
          signature = result;
          break;
        }
        if (result === "KEY_UNAVAILABLE") signature = result;
      } catch {
        /* No signer/network/parse exception can produce PASS. */
      }
    }
    return {
      manifestRef: exact(row.manifest_revision_id, row.version, row.content_hash),
      integrity: integrity ? ("PASS" as const) : ("FAIL" as const),
      signature: signature === "VALID" ? ("PASS" as const) : ("FAIL" as const),
      keyStatus: signature === "VALID" ? ("PINNED_TRUSTED" as const) : ("UNKNOWN" as const),
      safeIssueCodes:
        signature === "VALID"
          ? []
          : [
              signature === "KEY_UNAVAILABLE"
                ? "EVIDENCE_KEY_UNAVAILABLE"
                : "EVIDENCE_SIGNATURE_INVALID",
            ],
      verifiedAt: this.clock().toISOString(),
      correlationId: randomUUID(),
    };
  }
  async verify(request: Request & Readonly<{ manifestId: string; revision: number }>) {
    const access = await this.access(request);
    return await this.source.transaction(async (manager) => {
      const row = await this.manifest(
        manager,
        request,
        request.manifestId,
        request.revision,
        access,
      );
      const result = await this.verification(manager, request, row);
      await this.reauthorize(request, access);
      return result;
    });
  }
  private async package(
    manager: EntityManager,
    request: Request,
    packageId: string,
    access: QaApiAuthorization,
    version?: number,
  ): Promise<Package> {
    const rows = (await manager.query(
      "SELECT semantic_body,content_hash,version,work_item_id FROM qa_evidence_packages WHERE workspace_id=$1 AND project_id=$2 AND package_id=$3 AND ($4::integer IS NULL OR version=$4) ORDER BY version DESC LIMIT 1",
      [request.workspaceId, request.projectId, packageId, version ?? null],
    )) as { semantic_body: Package; content_hash: string; version: number; work_item_id: string }[];
    const row = rows[0];
    if (!row) return fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
    const value = row.semantic_body;
    try {
      schemas.validateById("urn:awp:schemas:007:evidence-package:v1", value);
    } catch {
      return fail(422, "EVIDENCE_PACKAGE_INVALID");
    }
    if (
      !hashed(value) ||
      value.contentHash !== row.content_hash ||
      value.workspaceId !== request.workspaceId ||
      value.projectId !== request.projectId ||
      value.packageId !== packageId ||
      value.version !== row.version ||
      value.workItemId !== row.work_item_id
    )
      fail(422, "EVIDENCE_PACKAGE_INVALID");
    if (value.manifestRevisionRefs.length !== value.signatureRefs.length)
      fail(422, "EVIDENCE_PACKAGE_INVALID");
    for (let index = 0; index < value.manifestRevisionRefs.length; index++) {
      const ref = value.manifestRevisionRefs[index]!;
      const manifests = (await manager.query(
        "SELECT * FROM qa_evidence_manifest_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND manifest_revision_id=$3 AND version=$4 AND content_hash=$5 AND work_item_id=$6",
        [
          request.workspaceId,
          request.projectId,
          ref.id,
          ref.version,
          ref.contentHash,
          value.workItemId,
        ],
      )) as ManifestRow[];
      const manifest = manifests[0];
      if (!manifest) return fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
      await this.classification(manager, access, manifest.effective_classification_key);
      // Signatures are matched by their exact manifest subject, independently of set ordering.
      let valid = false;
      for (const signature of value.signatureRefs)
        if ((await this.verification(manager, request, manifest, signature)).signature === "PASS") {
          valid = true;
          break;
        }
      if (!valid) fail(422, "EVIDENCE_PACKAGE_SIGNATURE_INVALID");
    }
    return value;
  }
  async getPackage(request: Request & Readonly<{ packageId: string }>) {
    const access = await this.access(request);
    return await this.source.transaction(async (manager) => {
      const value = await this.package(manager, request, request.packageId, access);
      await this.reauthorize(request, access);
      return value;
    });
  }
  async exportOptions(request: Request) {
    const access = await this.access(request),
      crypto = this.scopedCrypto(request);
    return await this.source.transaction(async (manager) => {
      await this.exportPolicy(manager, request, crypto, crypto.redactionPolicyRef);
      await this.reauthorize(request, access);
      return {
        formats: ["JSON"] as const,
        redactionPolicyRef: crypto.redactionPolicyRef,
        stepUpRequired: true,
      };
    });
  }
  async getExport(request: Request & Readonly<{ exportId: string }>) {
    await this.access(request);
    return await this.source.transaction(async (manager) => {
      const { access } = await this.lockAuthority(manager, request, "qa.evidence.export", true);
      const rows = (await manager.query(
        "SELECT semantic_body,content_hash FROM evidence_export_records WHERE workspace_id=$1 AND project_id=$2 AND export_id=$3 AND status='COMPLETED'",
        [request.workspaceId, request.projectId, request.exportId],
      )) as {
        semantic_body: {
          requestedBy: { principalId: string };
          subjectRef: ExactRevisionRef;
          redactionPolicyRef: ExactRevisionRef;
          exportPolicyRef: ExactRevisionRef;
          payload: unknown;
          resultHash: string;
          contentHash: string;
          [key: string]: unknown;
        };
        content_hash: string;
      }[];
      const row = rows[0];
      if (!row || row.semantic_body.requestedBy.principalId !== access.actor.principalId)
        return fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
      const record = row.semantic_body,
        crypto = this.scopedCrypto(request);
      if (
        !hashed(record) ||
        record.contentHash !== row.content_hash ||
        evidenceContentHash(record.payload) !== record.resultHash
      )
        fail(422, "EVIDENCE_EXPORT_INTEGRITY_INVALID");
      await this.exportPolicy(manager, request, crypto, record.redactionPolicyRef);
      if (!sameRef(record.exportPolicyRef, crypto.exportPolicyRef))
        fail(422, "EVIDENCE_EXPORT_POLICY_UNAVAILABLE");
      await this.package(manager, request, record.subjectRef.id, access, record.subjectRef.version);
      await this.reauthorize(request, access);
      return record.payload;
    });
  }
  private async lockAuthority(
    manager: EntityManager,
    request: Request,
    permission: string,
    stepUp: boolean,
  ) {
    const access = await this.access(request),
      authentication = access.authentication,
      now = this.clock().getTime();
    if (!authentication?.contextRef || !Number.isFinite(Date.parse(authentication.verifiedAt)))
      return fail(403, "EVIDENCE_AUTHENTICATION_CONTEXT_REQUIRED");
    if (
      stepUp &&
      (!authentication.stepUpAt ||
        !Number.isFinite(Date.parse(authentication.stepUpAt)) ||
        Date.parse(authentication.stepUpAt) > now ||
        now - Date.parse(authentication.stepUpAt) > 300_000)
    )
      fail(403, "EVIDENCE_STEP_UP_REQUIRED");
    const membership = access.basis.membershipRef;
    const memberships = (await manager.query(
      "SELECT m.id FROM workspace_memberships m JOIN identities i ON i.id=m.principal_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.row_version=$3 AND m.principal_id=$4 AND m.state='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND i.issuer=$5 AND i.subject=$6 FOR SHARE OF m,i",
      [
        request.workspaceId,
        membership.id,
        membership.version,
        access.actor.principalId,
        access.actor.issuer,
        access.actor.subject,
      ],
    )) as unknown[];
    if (memberships.length !== 1) fail(403, "EVIDENCE_AUTHORIZATION_REVOKED");
    const roles = (await manager.query(
      "SELECT id,row_version,role_key,effect,permissions FROM role_assignments WHERE workspace_id=$1 AND (project_id=$2 OR project_id IS NULL) AND principal_id=$3 AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) ORDER BY id FOR SHARE",
      [request.workspaceId, request.projectId, access.actor.principalId],
    )) as {
      id: string;
      row_version: number;
      role_key: string;
      effect: string;
      permissions: string[];
    }[];
    const permits = (permissions: string[]) =>
      permissions.includes(permission) || permissions.includes("*");
    const role = roles.find(
      (r) =>
        r.effect === "ALLOW" &&
        permits(r.permissions) &&
        access.basis.roleAssignmentRefs.some(
          (ref) => ref.id === r.id && ref.version === r.row_version,
        ),
    );
    if (!role || roles.some((r) => r.effect === "DENY" && permits(r.permissions)))
      return fail(403, "EVIDENCE_AUTHORIZATION_REVOKED");
    const entitlements = (await manager.query(
      "SELECT id,row_version,effect,permissions FROM project_entitlements WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) FOR SHARE",
      [request.workspaceId, request.projectId, access.actor.principalId],
    )) as { id: string; row_version: number; effect: string; permissions: string[] }[];
    if (
      !entitlements.some(
        (e) =>
          e.effect === "ALLOW" &&
          permits(e.permissions) &&
          access.basis.entitlementRefs.some(
            (ref) => ref.id === e.id && ref.version === e.row_version,
          ),
      ) ||
      entitlements.some((e) => e.effect === "DENY" && permits(e.permissions))
    )
      fail(403, "EVIDENCE_AUTHORIZATION_REVOKED");
    return {
      access,
      human: {
        kind: "HUMAN" as const,
        principalId: access.actor.principalId,
        roleKey: role.role_key,
        authorizationBasisHash: evidenceContentHash(access.basis),
        authenticationContextRef: authentication.contextRef,
      },
    };
  }
  private async command(
    manager: EntityManager,
    request: Request,
    actorId: string,
    operation: string,
    key: string,
    body: unknown,
    work: () => Promise<Receipt>,
  ): Promise<Receipt> {
    const values = [request.workspaceId, request.projectId, actorId, operation, key],
      hash = evidenceContentHash(body);
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify(values),
    ]);
    const rows = (await manager.query(
      "SELECT request_hash,result_ref FROM client_request_idempotency WHERE workspace_id=$1 AND project_id=$2 AND actor_id=$3 AND operation=$4 AND client_key=$5",
      values,
    )) as { request_hash: string; result_ref: Receipt }[];
    if (rows[0]) {
      if (rows[0].request_hash !== hash) fail(409, "EVIDENCE_IDEMPOTENCY_CONFLICT");
      return rows[0].result_ref;
    }
    const receipt = await work();
    await manager.query(
      "INSERT INTO client_request_idempotency(workspace_id,project_id,actor_id,operation,client_key,request_hash,result_ref,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())",
      [...values, hash, receipt],
    );
    return receipt;
  }
  private async audit(
    manager: EntityManager,
    request: Request,
    access: QaApiAuthorization,
    action: string,
    receipt: Receipt,
    classification: string,
  ) {
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED','EVIDENCE_COMMAND_COMPLETED',$7,$7,$8,$9,$10)",
      [
        randomUUID(),
        request.workspaceId,
        request.projectId,
        this.clock(),
        access.actor,
        action,
        receipt.correlationId,
        access.basis,
        classification,
        { resultRef: receipt.resultRef },
      ],
    );
  }
  async correct(
    request: Request &
      Readonly<{
        manifestId: string;
        expectedVersion: number;
        key: string;
        kind: "CLERICAL" | "SUBSTANTIVE_CORRECTION";
        reason: string;
      }>,
  ): Promise<Receipt> {
    await this.access(request);
    return await this.source.transaction(async (manager) => {
      const { access, human } = await this.lockAuthority(
        manager,
        request,
        "qa.evidence.post-close-correction.record",
        false,
      );
      return await this.command(
        manager,
        request,
        access.actor.principalId,
        "evidence.correct",
        request.key,
        {
          manifestId: request.manifestId,
          expectedVersion: request.expectedVersion,
          kind: request.kind,
          reason: request.reason,
        },
        async () => {
          const heads = (await manager.query(
            "SELECT current_revision,row_version FROM qa_evidence_manifest_headers_v2 WHERE workspace_id=$1 AND project_id=$2 AND manifest_id=$3 FOR UPDATE",
            [request.workspaceId, request.projectId, request.manifestId],
          )) as { current_revision: number; row_version: string }[];
          const head = heads[0];
          if (!head) return fail(404, "PROJECT_RESOURCE_NOT_AVAILABLE");
          if (Number(head.row_version) !== request.expectedVersion)
            fail(409, "EVIDENCE_VERSION_CONFLICT");
          const row = await this.manifest(
            manager,
            request,
            request.manifestId,
            head.current_revision,
            access,
          );
          if ((await this.verification(manager, request, row)).signature !== "PASS")
            fail(422, "EVIDENCE_SIGNATURE_INVALID");
          const { contentHash: previousHash, ...previous } = row.semantic_body,
            at = this.clock().toISOString();
          const body = {
            ...previous,
            manifestRevisionId: randomUUID(),
            version: previous.version + 1,
            kind: request.kind,
            previousRevisionRef: exact(previous.manifestRevisionId, previous.version, previousHash),
            correctionReason: request.reason,
            humanAttestation: { actor: human, attestedAt: at },
            createdAt: at,
          };
          const manifest: QaEvidenceManifestRevisionV2 = {
            ...body,
            contentHash: evidenceContentHash(body),
          };
          schemas.validateById("urn:awp:schemas:007:evidence-manifest:v2", manifest);
          const crypto = this.scopedCrypto(request),
            signature = await crypto.signManifest(manifest);
          schemas.validateById("urn:awp:schemas:007:evidence-signature-envelope:v1", signature);
          if ((await crypto.verify(manifest, signature)) !== "VALID")
            fail(503, "EVIDENCE_SIGNER_UNAVAILABLE");
          await this.reauthorize(request, access);
          await manager.query(
            `INSERT INTO qa_evidence_manifest_revisions_v2(manifest_revision_id,manifest_id,version,kind,previous_revision_id,previous_version,previous_content_hash,correction_reason,workspace_id,project_id,work_item_id,session_id,target_snapshot_id,target_snapshot_hash,effective_classification_key,human_attestation,semantic_body,created_at,content_hash)
          SELECT $4,manifest_id,$5,$6,manifest_revision_id,version,content_hash,$7,workspace_id,project_id,work_item_id,session_id,target_snapshot_id,target_snapshot_hash,effective_classification_key,$8,$9,$10,$11 FROM qa_evidence_manifest_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND manifest_revision_id=$3`,
            [
              request.workspaceId,
              request.projectId,
              previous.manifestRevisionId,
              manifest.manifestRevisionId,
              manifest.version,
              manifest.kind,
              request.reason,
              manifest.humanAttestation,
              manifest,
              at,
              manifest.contentHash,
            ],
          );
          await manager.query(
            "INSERT INTO qa_evidence_signature_envelopes(signature_id,version,workspace_id,project_id,manifest_revision_id,manifest_revision_version,manifest_content_hash,payload_hash,serialization,signature_format,protected_header,signature,signing_policy_ref,public_key_ref,signed_at,semantic_body,content_hash) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            [
              signature.signatureId,
              request.workspaceId,
              request.projectId,
              manifest.manifestRevisionId,
              manifest.version,
              manifest.contentHash,
              signature.payloadHash,
              signature.serialization,
              signature.format,
              signature.protectedHeader,
              signature.signature,
              signature.signingPolicyRef,
              signature.publicKeyRef,
              signature.signedAt,
              signature,
              signature.contentHash,
            ],
          );
          await manager.query(
            "INSERT INTO qa_evidence_manifest_artifact_memberships_v2 SELECT workspace_id,project_id,$4,ordinal,artifact_id,checksum,classification_key,availability_at_signing,retention_policy_ref FROM qa_evidence_manifest_artifact_memberships_v2 WHERE workspace_id=$1 AND project_id=$2 AND manifest_revision_id=$3",
            [
              request.workspaceId,
              request.projectId,
              previous.manifestRevisionId,
              manifest.manifestRevisionId,
            ],
          );
          await manager.query(
            "UPDATE qa_evidence_manifest_headers_v2 SET current_revision=$4,current_adjudicative_revision=CASE WHEN $5='SUBSTANTIVE_CORRECTION' THEN $4 ELSE current_adjudicative_revision END,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND manifest_id=$3",
            [
              request.workspaceId,
              request.projectId,
              request.manifestId,
              manifest.version,
              request.kind,
            ],
          );
          const receipt: Receipt = {
            commandId: randomUUID(),
            state: "COMPLETED",
            resultRef: exact(manifest.manifestRevisionId, manifest.version, manifest.contentHash),
            correlationId: randomUUID(),
          };
          await this.audit(
            manager,
            request,
            access,
            "qa.evidence.correct",
            receipt,
            manifest.effectiveClassificationKey,
          );
          return receipt;
        },
      );
    });
  }
  async exportPackage(
    request: Request &
      Readonly<{
        packageId: string;
        packageVersion: number;
        key: string;
        redactionPolicyRef: ExactRevisionRef;
        format: "JSON" | "ZIP";
        reason: string;
      }>,
  ): Promise<Receipt> {
    await this.access(request);
    if (request.format !== "JSON") return fail(422, "EVIDENCE_EXPORT_FORMAT_UNSUPPORTED");
    return await this.source.transaction(async (manager) => {
      const { access } = await this.lockAuthority(manager, request, "qa.evidence.export", true);
      const value = await this.package(
          manager,
          request,
          request.packageId,
          access,
          request.packageVersion,
        ),
        crypto = this.scopedCrypto(request);
      await this.exportPolicy(manager, request, crypto, request.redactionPolicyRef);
      return await this.command(
        manager,
        request,
        access.actor.principalId,
        "evidence.export",
        request.key,
        {
          packageId: request.packageId,
          packageVersion: request.packageVersion,
          redactionPolicyRef: request.redactionPolicyRef,
          format: request.format,
          reason: request.reason,
        },
        async () => {
          // Metadata JSON policy deliberately exports exact opaque references only.
          const payload = {
            packageId: value.packageId,
            version: value.version,
            workspaceId: value.workspaceId,
            projectId: value.projectId,
            workItemId: value.workItemId,
            manifestRevisionRefs: value.manifestRevisionRefs,
            signatureRefs: value.signatureRefs,
            contentHash: value.contentHash,
          };
          if (/https?:\/\/|opaqueLocator|secretRef|credential/iu.test(JSON.stringify(payload)))
            fail(422, "EVIDENCE_EXPORT_LOCATOR_FORBIDDEN");
          const exportId = randomUUID(),
            resultHash = evidenceContentHash(payload),
            at = this.clock().toISOString(),
            correlationId = randomUUID();
          const record = {
            exportId,
            workspaceId: request.workspaceId,
            projectId: request.projectId,
            status: "COMPLETED",
            subjectRef: exact(value.packageId, value.version, value.contentHash),
            requestedBy: access.actor,
            authorizationBasisRef: access.basis,
            redactionPolicyRef: crypto.redactionPolicyRef,
            exportPolicyRef: crypto.exportPolicyRef,
            includedManifestRefs: value.manifestRevisionRefs,
            includedArtifactRefs: [],
            resultHash,
            correlationId,
            createdAt: at,
            payload,
          };
          const contentHash = evidenceContentHash(record);
          await this.reauthorize(request, access);
          await manager.query(
            "INSERT INTO evidence_export_records(export_id,workspace_id,project_id,subject_ref,requested_by,authorization_basis_ref,redaction_policy_ref,export_policy_ref,included_manifest_refs,included_artifact_refs,result_hash,status,correlation_id,created_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]',$10,'COMPLETED',$11,$12,$13,$14)",
            [
              exportId,
              request.workspaceId,
              request.projectId,
              record.subjectRef,
              access.actor,
              access.basis,
              crypto.redactionPolicyRef,
              crypto.exportPolicyRef,
              JSON.stringify(value.manifestRevisionRefs),
              resultHash,
              correlationId,
              at,
              { ...record, contentHash },
              contentHash,
            ],
          );
          const receipt: Receipt = {
            commandId: exportId,
            state: "COMPLETED",
            resultRef: exact(exportId, 1, contentHash),
            correlationId,
          };
          await this.audit(
            manager,
            request,
            access,
            "qa.evidence.export",
            receipt,
            access.classificationCeiling,
          );
          return receipt;
        },
      );
    });
  }
  private async exportPolicy(
    manager: EntityManager,
    request: Request,
    crypto: EvidenceCrypto,
    requested: ExactRevisionRef,
  ) {
    const contexts = (await manager.query(
      "SELECT r.semantic_body,r.content_hash FROM qa_project_context_headers_v2 h JOIN qa_project_context_revisions_v2 r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.context_id=h.context_id AND r.version=h.current_published_version AND r.state='PUBLISHED' WHERE h.workspace_id=$1 AND h.project_id=$2 FOR SHARE OF h,r",
      [request.workspaceId, request.projectId],
    )) as {
      semantic_body: {
        workspaceId: string;
        projectId: string;
        redactionPolicyRef?: ExactRevisionRef;
        exportPolicyRef?: ExactRevisionRef;
        contentHash?: string;
      };
      content_hash: string;
    }[];
    const row = contexts[0],
      policy = row?.semantic_body;
    if (
      !row ||
      !policy?.redactionPolicyRef ||
      !policy.exportPolicyRef ||
      policy.workspaceId !== request.workspaceId ||
      policy.projectId !== request.projectId
    )
      return fail(422, "EVIDENCE_EXPORT_POLICY_UNAVAILABLE");
    const { contentHash, ...body } = policy;
    if (
      evidenceContentHash(body) !== row.content_hash ||
      (contentHash !== undefined && contentHash !== row.content_hash) ||
      !sameRef(policy.redactionPolicyRef, requested) ||
      !sameRef(policy.redactionPolicyRef, crypto.redactionPolicyRef) ||
      !sameRef(policy.exportPolicyRef, crypto.exportPolicyRef)
    )
      fail(422, "EVIDENCE_EXPORT_POLICY_UNAVAILABLE");
  }
}
