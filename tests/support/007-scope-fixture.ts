import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DataSource } from "typeorm";

import { digest } from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  createWorkItemOrdering,
  defaultClassificationCatalog,
} from "../../packages/platform-core/src/index.ts";
import {
  QueueProjectionRepository,
  TypeOrmArtifactRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { seedEvidenceHttpProject } from "./007-evidence-http-fixture.ts";

export const scopePermissions = [
  "project.catalog.read",
  "project.onboarding.read",
  "work-item.read",
  "artifact.read",
  "qa.evidence.read",
  "qa.evidence.verify",
  "qa.evidence.export",
  "queue.project.read",
  "queue.portfolio.read",
  "queue.capacity.read",
];
export async function prepareScopePrincipals(source: DataSource) {
  for (const persona of ["lead.alpha", "executor.alpha"] as const) {
    await source.query(
      "UPDATE project_entitlements SET revoked_at=now(),row_version=row_version+1 WHERE workspace_id=$1 AND principal_id=$2 AND revoked_at IS NULL",
      [localSeedIds.workspaceFunctional, localPersonaIds[persona]],
    );
    await source.query(
      "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW',$5,now())",
      [
        randomUUID(),
        localSeedIds.workspaceFunctional,
        localPersonaIds[persona],
        persona === "lead.alpha" ? "qa-lead" : "qa-executor",
        JSON.stringify(scopePermissions),
      ],
    );
  }
}
export async function prepareScopeResources(
  source: DataSource,
  directory: string,
  scope: { workspaceId: string; projectId: string },
  classification: "INTERNAL" | "RESTRICTED",
  generationId: string,
) {
  const workItemId = randomUUID(),
    at = new Date().toISOString();
  await source.query(
    "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7)",
    [
      workItemId,
      scope.workspaceId,
      scope.projectId,
      localSeedIds.workType,
      localPersonaIds["owner.local"],
      classification,
      at,
    ],
  );
  const evidence = await seedEvidenceHttpProject(
    source,
    directory,
    scope,
    workItemId,
    classification,
  );
  const artifactId = randomUUID(),
    bytes = Buffer.from(`Visible evidence for ${scope.projectId}`),
    checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  await writeFile(join(directory, artifactId), bytes);
  await new TypeOrmArtifactRepository(source).save(
    { kind: "PROJECT", ...scope },
    {
      id: artifactId,
      ...scope,
      owner: { entityType: "WORK_ITEM", entityId: workItemId },
      artifactKind: "QA_EVIDENCE",
      storage: {
        providerKind: "CONTROLLED_FILE",
        opaqueLocator: artifactId,
        objectVersionOrEtag: "1",
      },
      fileName: `${classification}-proof.txt`,
      mediaType: "text/plain",
      sizeBytes: bytes.length,
      checksum: { algorithm: "SHA256", value: checksum },
      classification: defaultClassificationCatalog.reference(classification),
      availability: "AVAILABLE",
      createdBy: localPersonaIds["owner.local"],
      createdAt: new Date(at),
    },
  );
  const queue = new QueueProjectionRepository(source),
    queueEntryId = randomUUID();
  await queue.ensureHead({
    scope: { kind: "PROJECT", ...scope },
    queueEntryId,
    subject: { kind: "WORK_ITEM", workItemId },
    createdAt: at,
  });
  const document = {
    subject: {
      kind: "WORK_ITEM",
      id: workItemId,
      version: 1,
      semanticHash: digest({ workItemId }),
    },
    stage: "BACKLOG",
    stageDetails: { detail: "NEEDS_INFO" },
    stageReasonCodes: ["NEEDS_INFO"],
    operational: { state: "PENDING" },
    qa: { state: "KNOWN", readiness: "NOT_ASSESSED", activities: [] },
    control: { state: "DEFAULT", resourceVersion: 0, serviceClass: "STANDARD" },
    capacity: { state: "NOT_CONSUMING" },
    sla: { state: "NOT_APPLICABLE" },
    ordering: createWorkItemOrdering({
      serviceClassBand: "STANDARD",
      slaState: "NOT_STARTED",
      urgencyTiming: { state: "NOT_STARTED" },
      jiraPriority: { state: "UNKNOWN" },
      acceptedRisk: "UNKNOWN",
      acceptedBusinessImpact: "UNKNOWN",
      dependencyReadiness: "UNKNOWN",
      readyAge: { state: "NOT_APPLICABLE" },
      readyAt: { state: "NOT_APPLICABLE" },
      jiraDisplayKey: { state: "NOT_APPLICABLE" },
      workItemId,
    }),
    consistencyWarnings: [],
    freshness: { state: "CURRENT" },
    sourceRefs: [
      {
        sourceType: "WORK_ITEM_REVISION",
        sourceId: workItemId,
        sourceVersion: 1,
        semanticHash: digest({ workItemId }),
      },
    ],
    sourceSetHash: digest({ workItemId }),
    policyFacetRef: { id: randomUUID(), version: 1, semanticHash: digest("controlled-policy") },
    derivationRuleRef: {
      key: "queue-stage",
      version: "1.0.0",
      semanticHash: digest("queue-stage"),
    },
    inputFingerprint: digest({ workItemId }),
    calculatedAt: at,
  };
  await queue.appendRevision({
    scope: { kind: "PROJECT", ...scope },
    queueEntryId,
    generationId,
    revisionId: randomUUID(),
    expectedResourceVersion: 0,
    semanticHash: digest(document),
    document,
  });
  return { ...scope, workItemId, artifactId, bytes, checksum, queueEntryId, ...evidence };
}
