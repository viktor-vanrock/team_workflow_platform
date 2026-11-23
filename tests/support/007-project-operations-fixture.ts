import { randomUUID } from "node:crypto";

import {
  appendOnboarding,
  currentAuthority,
  digest,
  ref,
} from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  createOnboardingRevision,
  createProjectRegistryRevision,
} from "../../packages/platform-core/src/index.ts";
import { ProjectBindingRepository } from "../../packages/platform-persistence-typeorm/src/project-binding.repository.ts";
import { createSafeCapabilityProbe } from "../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { startEvidenceHttpFixture } from "./007-evidence-http-fixture.ts";

export async function startProjectOperationsFixture(
  image: string,
  options: { stage?: "SHADOW" | "PILOT_ACTIVE" } = {},
) {
  const f = await startEvidenceHttpFixture(image);
  try {
    const scope = f.scope,
      now = new Date().toISOString(),
      bindingId = randomUUID(),
      profileId = randomUUID(),
      connectionId = randomUUID();
    const connection = {
        connectorKey: "connector-jira",
        environmentScope: "LOCAL",
        endpoint: "http://mock-hub:4000/jira",
      },
      connectionRef = ref(connectionId, 1, digest(connection));
    const profile = {
        connectorKey: "connector-jira",
        connectionRef,
        capabilityConfigurations: [
          {
            capabilityKey: "operational-work-item",
            exactContractVersion: "1.0.0",
            environmentScopes: ["LOCAL"],
            operations: [
              "request.create",
              "request.transition",
              "request.read",
              "defect.create",
            ].map((operation) => ({ operation })),
          },
        ],
      },
      profileRef = ref(profileId, 1, digest(profile));
    await f.source.query(
      "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,1)",
      [connectionId, scope.workspaceId, connectionId],
    );
    await f.source.query(
      "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6)",
      [randomUUID(), scope.workspaceId, connectionId, connection, connectionRef.contentHash, now],
    );
    await f.source.query(
      "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,1)",
      [profileId, scope.workspaceId, profileId],
    );
    await f.source.query(
      "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6)",
      [randomUUID(), scope.workspaceId, profileId, profile, profileRef.contentHash, now],
    );
    const entries = ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT", "DEFECT_DESTINATION"].map(
      (logicalRole) => ({
        logicalRole,
        capabilityKey: "operational-work-item",
        exactContractVersion: "1.0.0",
        profileRef,
        environmentScope: "LOCAL",
      }),
    );
    const binding = { ...scope, entries },
      bindingRef = ref(bindingId, 1, digest(binding));
    await f.source.query(
      "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,$4,1)",
      [bindingId, scope.workspaceId, scope.projectId, bindingId],
    );
    await f.source.query(
      "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,$7)",
      [
        randomUUID(),
        scope.workspaceId,
        scope.projectId,
        bindingId,
        binding,
        bindingRef.contentHash,
        now,
      ],
    );
    const contextRows = (await f.source.query(
      "SELECT content_hash FROM qa_project_context_revisions_v2 WHERE context_id=$1",
      [f.contextId],
    )) as { content_hash: `sha256:${string}` }[];
    const contextRef = ref(f.contextId, 1, contextRows[0]!.content_hash);
    let initial!: ReturnType<typeof createOnboardingRevision>;
    await f.source.transaction(async (manager) => {
      const authority = await currentAuthority(
        manager,
        { kind: "PROJECT", ...scope },
        localPersonaIds["integration-admin.alpha"],
        "project.suspend",
        "integration-administrator",
      );
      const registry = createProjectRegistryRevision({
        revisionId: randomUUID(),
        version: 1,
        ...scope,
        key: "ALPHA",
        name: "Alpha",
        ownerIds: [localPersonaIds["owner.local"]],
        criticalityKey: "STANDARD",
        dataClassificationKey: "INTERNAL",
        verificationStatus: "CURRENT",
        reason: "Controlled registry",
        createdBy: authority.human,
        createdAt: now,
      });
      await manager.query(
        "INSERT INTO project_registry_revisions(revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,reason,created_by,created_at,semantic_body,content_hash) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,'CURRENT',$9,$10,$11,$12,$13)",
        [
          registry.revisionId,
          scope.workspaceId,
          scope.projectId,
          registry.key,
          registry.name,
          JSON.stringify(registry.ownerIds),
          registry.criticalityKey,
          registry.dataClassificationKey,
          registry.reason,
          authority.actor.principalId,
          now,
          registry,
          registry.contentHash,
        ],
      );
      const registryRef = ref(registry.revisionId, 1, registry.contentHash);
      initial = createOnboardingRevision({
        revisionId: randomUUID(),
        onboardingId: randomUUID(),
        version: 1,
        ...scope,
        stage: options.stage ?? "PILOT_ACTIVE",
        qaCapabilityMode: "MANUAL_ONLY",
        operationalState: "ACTIVE",
        intendedCapabilityMode: "MANUAL_ONLY",
        projectRegistryRef: registryRef,
        bindingRef,
        qaProjectContextRef: contextRef,
        starterEntitlementSetHash: digest([]),
        gateResultRefs: [],
        ownerSetHash: digest([localPersonaIds["owner.local"]]),
        reason: "Independent operations fixture",
        reasonCode: "PROJECT_REGISTERED",
        actor: authority.human,
        correlationId: randomUUID(),
        createdAt: now,
      });
      await manager.query(
        "INSERT INTO project_onboarding_headers(onboarding_id,workspace_id,project_id,current_version,current_stage,current_capability_mode,current_operational_state,intended_capability_mode,created_at,updated_at) VALUES($1,$2,$3,1,$5,'MANUAL_ONLY','ACTIVE','MANUAL_ONLY',$4,$4)",
        [initial.onboardingId, scope.workspaceId, scope.projectId, now, initial.stage],
      );
      await appendOnboarding(manager, initial);
    });
    const probes = [];
    for (const [logicalRole, operations] of [
      ["QA_REQUEST_AUTHORITY", ["request.create", "request.transition"]],
      ["SOURCE_CONTEXT", ["request.read"]],
      ["DEFECT_DESTINATION", ["defect.create"]],
    ] as const)
      for (const operation of operations) {
        const probe = createSafeCapabilityProbe({
          ...scope,
          probeId: randomUUID(),
          bindingRef,
          profileRef,
          connectionRef,
          validationReportRef: ref(randomUUID(), 1, digest(binding)),
          logicalRole,
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          operation,
          environmentScope: "LOCAL",
          status: "AVAILABLE",
          safeIssueCodes: [],
          observedAt: now,
          validUntil: new Date(Date.now() + 600_000).toISOString(),
        });
        await new ProjectBindingRepository(f.source).appendCapabilityProbe(probe);
        probes.push(probe);
      }
    return { ...f, bindingRef, profileRef, connectionRef, contextRef, initial, probes };
  } catch (error) {
    await f.close();
    throw error;
  }
}
