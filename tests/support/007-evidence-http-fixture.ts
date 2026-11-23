import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EvidenceCrypto } from "../../apps/api/src/extensions/onboarding/evidence.application.ts";
import {
  createLocalEvidenceCrypto,
  localEvidencePolicies,
} from "../../apps/api/src/local/local-evidence-integrity.ts";
import {
  evidenceContentHash,
  type QaEvidenceManifestRevisionV2,
} from "../../packages/competency-qa/src/index.ts";
import { OfflineSchemaRegistry } from "../../packages/platform-contracts/src/index.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaLocalSeed } from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";

export async function startEvidenceHttpFixture(
  image: string,
  options: Readonly<{ tamperSignature?: boolean }> = {},
) {
  Object.assign(process.env, {
    AWP_RUNTIME_PROFILE: "test",
    AWP_COMPOSITION: "qa-local",
    AWP_EXTERNAL_NETWORK_MODE: "deny",
    AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    AWP_MOCK_HUB_URL: "http://127.0.0.1:1",
  });
  const postgres = await startPostgres(image),
    directory = await mkdtemp(join(tmpdir(), "awp-evidence-http-"));
  const source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  const close = async () => {
    if (source.isInitialized) await source.destroy();
    await postgres.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    await runQaLocalSeed(source);
    const scope = { workspaceId: localSeedIds.workspaceFunctional, projectId: localSeedIds.alpha };
    const material = await seedEvidenceHttpProject(
      source,
      directory,
      scope,
      localSeedIds.workItem,
      "INTERNAL",
      options,
    );
    return { source, postgres, directory, scope, ...material, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Controlled signed evidence input; HTTP authorization and export are exercised independently. */
export async function seedEvidenceHttpProject(
  source: ReturnType<typeof createPlatformDataSource>,
  directory: string,
  scope: { workspaceId: string; projectId: string },
  workItemId: string,
  classification: "INTERNAL" | "RESTRICTED",
  options: Readonly<{
    tamperSignature?: boolean;
    principalId?: string;
    workTypeId?: string;
    crypto?: (scope: { workspaceId: string; projectId: string }) => EvidenceCrypto;
  }> = {},
) {
  const at = new Date().toISOString();
  const ref = (id: string = randomUUID()) => ({
    id,
    version: 1,
    contentHash: evidenceContentHash({ id }),
  });
  const human = {
    kind: "HUMAN" as const,
    principalId: options.principalId ?? localPersonaIds["lead.alpha"],
    roleKey: "qa-lead",
    authorizationBasisHash: evidenceContentHash("fixture-grant"),
    authenticationContextRef: "verified-fixture-session",
  };
  const bound = (value: unknown) => ({
    schemaRef: {
      id: "urn:awp:schemas:007:target-snapshot:v2",
      version: 2,
      digest: evidenceContentHash("controlled-input-schema"),
    },
    value,
    contentHash: evidenceContentHash(value),
  });
  const sessionId = randomUUID(),
    snapshotId = randomUUID(),
    manifestId = randomUUID();
  const body = {
    schemaVersion: "qa-evidence-manifest@2.0.0" as const,
    manifestId,
    manifestRevisionId: randomUUID(),
    version: 1,
    kind: "INITIAL" as const,
    ...scope,
    workItemId,
    sessionId,
    workTypeDefinitionRef: ref(options.workTypeId ?? localSeedIds.workType),
    targetSnapshot: bound({ snapshotId, ...scope, workItemId, sessionId, mode: "MANUAL" }),
    scopeSnapshotRef: ref(),
    planItemResults: [
      {
        planItemRef: ref(),
        expectedOutcome: bound("Expected result"),
        actualOutcome: bound("Observed result"),
        canonicalResult: "PASS",
        startedAt: at,
        finishedAt: at,
      },
    ],
    attempts: [
      {
        attemptRef: ref(),
        actor: human,
        runnerRef: ref("controlled-manual-runner"),
        startedAt: at,
        finishedAt: at,
        resultRef: ref(),
      },
    ],
    observations: [],
    frozenFindingReviewRefs: [],
    artifactMembers: [],
    sessionOutcome: bound("PASSED"),
    outcomeSummary: bound("Controlled persisted evidence"),
    definitionRefs: [],
    ruleRefs: [],
    policyRefs: [],
    bindingRefs: [],
    profileRefs: [],
    connectionRefs: [],
    mappingRefs: [],
    humanAttestation: { actor: human, attestedAt: at },
    correlationId: randomUUID(),
    effectiveClassificationKey: classification,
    createdAt: at,
  };
  const manifest = {
    ...body,
    contentHash: evidenceContentHash(body),
  } as QaEvidenceManifestRevisionV2;
  const schemas = new OfflineSchemaRegistry();
  schemas.validateById("urn:awp:schemas:007:evidence-manifest:v2", manifest);
  const crypto = options.crypto ?? createLocalEvidenceCrypto(directory),
    signed = await crypto(scope).signManifest(manifest);
  const signature = options.tamperSignature
    ? (() => {
        const { contentHash: _hash, ...body } = signed;
        void _hash;
        const tampered = {
          ...body,
          signature: `${body.signature.startsWith("A") ? "B" : "A"}${body.signature.slice(1)}`,
        };
        return { ...tampered, contentHash: evidenceContentHash(tampered) };
      })()
    : signed;
  schemas.validateById("urn:awp:schemas:007:evidence-signature-envelope:v1", signature);
  await source.query(
    "INSERT INTO qa_target_snapshots_v2(snapshot_id,workspace_id,project_id,work_item_id,session_id,mode,semantic_body,captured_at,content_hash) VALUES($1,$2,$3,$4,$5,'MANUAL',$6,$7,$8)",
    [
      snapshotId,
      scope.workspaceId,
      scope.projectId,
      workItemId,
      sessionId,
      body.targetSnapshot.value,
      at,
      body.targetSnapshot.contentHash,
    ],
  );
  await source.query(
    "INSERT INTO qa_evidence_manifest_headers_v2(manifest_id,workspace_id,project_id,work_item_id,session_id,current_revision,current_adjudicative_revision) VALUES($1,$2,$3,$4,$5,1,1)",
    [manifestId, scope.workspaceId, scope.projectId, workItemId, sessionId],
  );
  await source.query(
    "INSERT INTO qa_evidence_manifest_revisions_v2(manifest_revision_id,manifest_id,version,kind,workspace_id,project_id,work_item_id,session_id,target_snapshot_id,target_snapshot_hash,effective_classification_key,human_attestation,semantic_body,created_at,content_hash) VALUES($1,$2,1,'INITIAL',$3,$4,$5,$6,$7,$8,$13,$9,$10,$11,$12)",
    [
      manifest.manifestRevisionId,
      manifestId,
      scope.workspaceId,
      scope.projectId,
      workItemId,
      sessionId,
      snapshotId,
      body.targetSnapshot.contentHash,
      body.humanAttestation,
      manifest,
      at,
      manifest.contentHash,
      classification,
    ],
  );
  await source.query(
    "INSERT INTO qa_evidence_signature_envelopes(signature_id,workspace_id,project_id,manifest_revision_id,manifest_revision_version,manifest_content_hash,payload_hash,serialization,signature_format,protected_header,signature,signing_policy_ref,public_key_ref,signed_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,1,$5,$5,'JCS_RFC8785','JWS_DETACHED',$6,$7,$8,$9,$10,$11,$12)",
    [
      signature.signatureId,
      scope.workspaceId,
      scope.projectId,
      manifest.manifestRevisionId,
      manifest.contentHash,
      signature.protectedHeader,
      signature.signature,
      signature.signingPolicyRef,
      signature.publicKeyRef,
      at,
      signature,
      signature.contentHash,
    ],
  );
  const packageId = randomUUID(),
    packageBody = {
      schemaVersion: 1,
      packageId,
      version: 1,
      ...scope,
      workItemId,
      manifestRevisionRefs: [
        { id: manifest.manifestRevisionId, version: 1, contentHash: manifest.contentHash },
      ],
      signatureRefs: [
        { id: signature.signatureId, version: 1, contentHash: signature.contentHash },
      ],
      qaVerdictRef: ref(),
      residualRiskHash: evidenceContentHash([]),
      packagePolicyRef: ref("package-policy"),
      createdBy: human,
      createdAt: at,
    };
  const evidencePackage = { ...packageBody, contentHash: evidenceContentHash(packageBody) };
  schemas.validateById("urn:awp:schemas:007:evidence-package:v1", evidencePackage);
  await source.query(
    "INSERT INTO qa_evidence_packages(package_id,version,workspace_id,project_id,work_item_id,manifest_revision_refs,signature_refs,qa_verdict_ref,residual_risk_hash,package_policy_ref,created_by,created_at,semantic_body,content_hash) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [
      packageId,
      scope.workspaceId,
      scope.projectId,
      workItemId,
      JSON.stringify(packageBody.manifestRevisionRefs),
      JSON.stringify(packageBody.signatureRefs),
      packageBody.qaVerdictRef,
      packageBody.residualRiskHash,
      packageBody.packagePolicyRef,
      human,
      at,
      evidencePackage,
      evidencePackage.contentHash,
    ],
  );
  const existingContexts = (await source.query(
    "SELECT context_id FROM qa_project_context_headers_v2 WHERE workspace_id=$1 AND project_id=$2",
    [scope.workspaceId, scope.projectId],
  )) as { context_id: string }[];
  const evidencePolicies = options.crypto
    ? {
        redactionPolicyRef: crypto(scope).redactionPolicyRef,
        exportPolicyRef: crypto(scope).exportPolicyRef,
      }
    : localEvidencePolicies;
  const contextId = existingContexts[0]?.context_id ?? randomUUID(),
    context = {
      ...scope,
      ...evidencePolicies,
      checklistPolicyRefs: [
        {
          id: options.crypto ? "controlled-checklist" : "local-checklist",
          version: 1,
          contentHash: evidenceContentHash({ checked: true }),
        },
      ],
    };
  if (!existingContexts.length) {
    await source.query(
      "INSERT INTO qa_project_context_headers_v2(context_id,workspace_id,project_id,current_version,current_published_version) VALUES($1,$2,$3,1,1)",
      [contextId, scope.workspaceId, scope.projectId],
    );
    await source.query(
      "INSERT INTO qa_project_context_revisions_v2(revision_id,context_id,workspace_id,project_id,version,state,environment_refs,test_data_catalog_refs,account_pool_refs,policy_refs,maximum_classification_key,resource_version,published_at,created_by,published_by,semantic_body,content_hash) VALUES($1,$2,$3,$4,1,'PUBLISHED','[]','[]','[]',$5,'INTERNAL',1,$6,$7,$7,$8,$9)",
      [
        randomUUID(),
        contextId,
        scope.workspaceId,
        scope.projectId,
        evidencePolicies,
        at,
        human,
        context,
        evidenceContentHash(context),
      ],
    );
  }
  return { manifest, signature, evidencePackage, contextId, crypto };
}
