import { randomUUID } from "node:crypto";

import {
  ManageAutomationSuiteService,
  publishQaProjectContextV2,
  type QaAutomationSuiteContent,
  qaAutomationSuiteValidationCheckOrder,
  type QaProjectContextV2,
  QaProjectResourceRepository,
  recordAutomationSuiteValidation,
  TypeOrmAutomationSuiteRepository,
} from "../../packages/competency-qa/src/node.ts";
import {
  type BindingFunctionalAcceptance,
  type CapabilityProbeResult,
  type ExactRevisionRef,
  pilotContentHash,
} from "../../packages/platform-core/src/index.ts";
import { ProjectBindingRepository } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type QaAutomationAvailabilityPins,
  qaAutomationProfilePinSetHash,
} from "../../packages/runtime-composition/src/pilot/automation-availability.ts";
import { us3Actor, type Us3DatabaseFixture } from "./002-us3-database.ts";

const hash = (body: unknown) => pilotContentHash(body) as `sha256:${string}`;
const ref = (id = randomUUID(), body: unknown = {}) => ({
  id,
  version: 1,
  contentHash: hash(body),
});
const requirements = [
  {
    logicalRole: "SOURCE_CONTEXT",
    capabilityKey: "source-context.read",
    operations: ["merge-request.read", "commit.read", "build.read"],
  },
  {
    logicalRole: "TEST_EXECUTION",
    capabilityKey: "test-executor.trigger-status",
    operations: ["pipeline.trigger", "pipeline.read", "pipeline.lookup"],
  },
  {
    logicalRole: "ARTIFACT_SOURCE",
    capabilityKey: "artifact.ci-read",
    operations: ["artifact.metadata", "artifact.stream"],
  },
] as const;

/** Controlled published fixtures exercise the read contract; they are not C1/provider conformance evidence. */
export async function seed008AutomationAvailability(
  f: Us3DatabaseFixture,
  options: { corruptProfileHash?: boolean; omittedProbe?: number } = {},
) {
  const { source, workspaceId, projectId } = f;
  const scope = { workspaceId, projectId };
  const at = new Date(Date.now() - 1000).toISOString();
  const publish = async (
    table: "connection" | "connector_profile" | "project_integration_binding",
    content: unknown,
  ) => {
    const pin = ref(randomUUID(), content);
    const scoped = table === "project_integration_binding";
    if (table === "connector_profile" && options.corruptProfileHash)
      pin.contentHash = `sha256:${"f".repeat(64)}`;
    await source.query(
      `INSERT INTO ${table}_headers(id,workspace_id,key,current_published_version${scoped ? ",project_id" : ""}) VALUES($1,$2,$3,1${scoped ? ",$4" : ""})`,
      [pin.id, workspaceId, randomUUID(), ...(scoped ? [projectId] : [])],
    );
    await source.query(
      `INSERT INTO ${table}_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at${scoped ? ",project_id" : ""}) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now()${scoped ? ",$6" : ""})`,
      [
        randomUUID(),
        workspaceId,
        pin.id,
        JSON.stringify(content),
        pin.contentHash,
        ...(scoped ? [projectId] : []),
      ],
    );
    return pin;
  };
  const connectionRef = await publish("connection", {
    connectorKey: "connector-gitlab",
    baseUrl: "https://gitlab.example.test",
  });
  const profileRef = await publish("connector_profile", {
    connectorKey: "connector-gitlab",
    connectionRef,
    numericGitLabProjectId: 7249,
    capabilityConfigurations: requirements.map((requirement) => ({
      capabilityKey: requirement.capabilityKey,
      exactContractVersion: "1.0.0",
      environmentScopes: ["NON_PROD"],
      operations: requirement.operations.map((operation) => ({
        operation,
        effect: operation === "pipeline.trigger" ? "WRITE" : "READ",
      })),
    })),
  });
  const roles = requirements.map(({ logicalRole }) => ({ logicalRole, profileRef, connectionRef }));
  const bindingRef = await publish("project_integration_binding", {
    entries: requirements.map((requirement) => ({
      ...requirement,
      exactContractVersion: "1.0.0",
      environmentScope: "NON_PROD",
      profileRef,
      externalScope: {
        kind: "GITLAB_PROJECT",
        value: { numericGitLabProjectId: 7249, environmentScope: "NON_PROD" },
      },
    })),
  });
  const reportId = randomUUID();
  const bindingReport = { id: reportId, status: "VALID", bindingRef };
  const bindingValidationRef = ref(reportId, bindingReport);
  await source.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,1,'VALID',$5,$6,$7)",
    [reportId, workspaceId, projectId, bindingRef.id, bindingRef.contentHash, bindingReport, at],
  );
  const existing = (await source.query(
    "SELECT semantic_body FROM qa_project_context_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND state='PUBLISHED' ORDER BY version DESC LIMIT 1",
    [workspaceId, projectId],
  )) as { semantic_body: QaProjectContextV2 }[];
  const exact = (value: QaProjectContextV2["evidencePolicyRef"]) => ({
    id: value.id,
    version: Number(value.version),
    contentHash: value.contentHash,
  });
  const environmentRef = existing[0] ? exact(existing[0].semantic_body.environmentRefs[0]!) : ref(),
    evidencePolicyRef = existing[0] ? exact(existing[0].semantic_body.evidencePolicyRef) : ref();
  const external = (pin: ExactRevisionRef, kind = "POLICY") => ({
    ...pin,
    version: String(pin.version),
    kind,
  });
  const policy = external(evidencePolicyRef);
  const context =
    existing[0]?.semantic_body ??
    publishQaProjectContextV2({
      contextId: randomUUID(),
      version: 1,
      ...scope,
      state: "PUBLISHED",
      environmentRefs: [external(environmentRef, "ENVIRONMENT")],
      testDataCatalogRefs: [policy],
      accountPoolRefs: [policy],
      targetPolicyRefs: [policy],
      scopePolicyRefs: [policy],
      checklistPolicyRefs: [policy],
      defaultTargetPolicyRef: policy,
      defaultScopePolicyRef: policy,
      defaultChecklistRefs: [policy],
      evidencePolicyRef: policy,
      retentionPolicyRef: policy,
      redactionPolicyRef: policy,
      exportPolicyRef: policy,
      riskReviewPolicyRef: policy,
      dorRuleSetRef: policy,
      dodRuleSetRef: policy,
      capabilityRequirementSetRef: policy,
      maximumClassificationKey: "INTERNAL",
      resourceVersion: 1,
      createdBy: us3Actor,
      publishedBy: us3Actor,
      publishedAt: at,
    });
  if (!existing[0])
    await source.transaction((manager) =>
      new QaProjectResourceRepository(manager).appendContext(context),
    );
  const contextRef = { id: context.contextId, version: 1, contentHash: context.contentHash };
  const content: QaAutomationSuiteContent = {
    ownerPrincipalId: us3Actor.principalId,
    suiteDefinitionRef: ref(),
    logicalExecutionContract: {
      pipelineKey: "qa.validation",
      sourceRefPolicyRef: "source-policy@1",
      resultJobKey: "machine-result",
      contractHash: hash("pipeline"),
    },
    allowedTargetTypes: ["MERGE_REQUEST", "COMMIT", "BUILD"],
    allowedEnvironmentRefs: [`${environmentRef.id}@1`],
    parameterSchemaRef: ref(),
    resultSchemaRef: ref(),
    artifactPolicyRef: evidencePolicyRef,
    retryPolicyRef: ref(),
    quarantinePolicyRef: ref(),
    capabilityRequirements: [
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ],
  };
  const created = await source.transaction((manager) =>
    new ManageAutomationSuiteService(new TypeOrmAutomationSuiteRepository(manager)).create({
      id: randomUUID(),
      scope,
      suiteKey: `suite-${randomUUID()}`,
      content,
      actor: us3Actor,
      createdAt: at,
    }),
  );
  const recorded = recordAutomationSuiteValidation(created.version, {
    id: randomUUID(),
    ...scope,
    suiteBindingRef: {
      id: created.version.id,
      version: 1,
      contentHash: created.version.contentHash,
    },
    status: "VALID",
    coreBindingRef: bindingRef,
    profilePinSetHash: qaAutomationProfilePinSetHash({ ...scope, bindingRef, roles }),
    discoverySnapshotRef: "controlled-discovery",
    discoverySnapshotHash: hash("discovery"),
    suiteProbeRef: "controlled-suite-probe",
    suiteProbeHash: hash("probe"),
    checks: qaAutomationSuiteValidationCheckOrder.map((key) => ({ key, passed: true })),
    issues: [],
    validatedBy: {
      kind: "SERVICE",
      principalId: "controlled-validator",
      serviceKey: "suite-validation",
    },
    authorizationBasisHash: hash("authorization"),
    createdAt: at,
  });
  await source.transaction(async (manager) => {
    const repository = new TypeOrmAutomationSuiteRepository(manager);
    await repository.persistValidation({
      scope,
      previousVersion: created.version,
      nextVersion: recorded.version,
      report: recorded.report,
    });
    await new ManageAutomationSuiteService(repository).publish({
      scope,
      header: created.header,
      versions: [recorded.version],
      reports: [recorded.report],
      versionId: recorded.version.id,
      expectedResourceVersion: created.header.resourceVersion,
      evidence: {
        coreBindingRef: bindingRef,
        profilePinSetHash: recorded.report.profilePinSetHash,
        discoverySnapshotHash: recorded.report.discoverySnapshotHash,
        suiteProbeHash: recorded.report.suiteProbeHash,
        discoveryCurrent: true,
        nonProduction: true,
        noDeploySurface: true,
      },
      publishedAt: at,
    });
  });
  const suiteRef = {
    id: recorded.version.id,
    version: 1,
    contentHash: recorded.version.contentHash,
  };
  const acceptanceBody: Omit<BindingFunctionalAcceptance, "contentHash"> = {
    ...scope,
    acceptanceId: randomUUID(),
    version: 1,
    bindingRef,
    validationReportRef: bindingValidationRef,
    qaProjectContextRef: contextRef,
    acceptedResourceRefs: [suiteRef, environmentRef, evidencePolicyRef],
    checklistRef: ref(),
    outcome: "ACCEPTED",
    safeIssueCodes: [],
    acceptedBy: {
      ...us3Actor,
      roleKey: "qa-owner",
      authorizationBasisRef: ref(),
      authenticationContextRef: ref(),
    },
    acceptedAt: at,
  };
  const acceptance: BindingFunctionalAcceptance = {
    ...acceptanceBody,
    contentHash: hash(acceptanceBody),
  };
  const bindingRepository = new ProjectBindingRepository(source);
  await bindingRepository.appendFunctionalAcceptance(acceptance);
  const probes: CapabilityProbeResult[] = [];
  for (const requirement of requirements)
    for (const operation of requirement.operations) {
      const body: Omit<CapabilityProbeResult, "contentHash"> = {
        ...scope,
        probeId: randomUUID(),
        version: 1,
        bindingRef,
        profileRef,
        connectionRef,
        validationReportRef: bindingValidationRef,
        logicalRole: requirement.logicalRole,
        capabilityKey: requirement.capabilityKey,
        exactContractVersion: "1.0.0",
        operation,
        environmentScope: "NON_PROD",
        status: "AVAILABLE",
        safeIssueCodes: [],
        observedAt: at,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        actorKind: "SERVICE",
      };
      const probe = { ...body, contentHash: hash(body) };
      if (probes.length !== options.omittedProbe)
        await bindingRepository.appendCapabilityProbe(probe);
      probes.push(probe);
    }
  await source.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,binding_ref,qa_project_context_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,actor,correlation_id,created_at,semantic_body,content_hash)
      SELECT $3,h.onboarding_id,h.workspace_id,h.project_id,h.current_version+1,'PILOT_ACTIVE','FULL_QA','ACTIVE','FULL_QA',r.project_registry_ref,$4,$5,r.starter_entitlement_set_hash,'[]',r.owner_set_hash,'CONTROLLED_READ_FIXTURE','Read projection fixture',$6,$7,now(),'{}',$8
      FROM project_onboarding_headers h JOIN project_onboarding_revisions r ON r.onboarding_id=h.onboarding_id AND r.version=h.current_version WHERE h.workspace_id=$1 AND h.project_id=$2`,
      [
        workspaceId,
        projectId,
        randomUUID(),
        bindingRef,
        contextRef,
        us3Actor,
        randomUUID(),
        hash({}),
      ],
    );
    await manager.query(
      "UPDATE project_onboarding_headers SET current_version=current_version+1,current_stage='PILOT_ACTIVE',current_capability_mode='FULL_QA',current_operational_state='ACTIVE',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2",
      [workspaceId, projectId],
    );
  });
  const pins: QaAutomationAvailabilityPins = {
    ...scope,
    bindingRef,
    contextRef,
    suiteBindingId: created.header.id,
    suiteRef,
    suiteValidationRef: {
      id: recorded.report.id,
      version: 1,
      contentHash: recorded.report.contentHash,
    },
    bindingValidationRef,
    acceptanceRef: { id: acceptance.acceptanceId, version: 1, contentHash: acceptance.contentHash },
    environmentRef,
    evidencePolicyRef,
    maximumEvidenceAgeMs: 60_000,
    roles,
  };
  const appendProbe = async (
    index: number,
    changes: Partial<Omit<CapabilityProbeResult, "contentHash">>,
  ) => {
    const previous = Object.fromEntries(
      Object.entries(probes[index]!).filter(([key]) => key !== "contentHash"),
    ) as Omit<CapabilityProbeResult, "contentHash">;
    const body = {
      ...previous,
      probeId: randomUUID(),
      observedAt: new Date().toISOString(),
      ...changes,
    };
    const next = { ...body, contentHash: hash(body) };
    await bindingRepository.appendCapabilityProbe(next);
    return next;
  };
  const rejectAcceptance = async () => {
    const previous = Object.fromEntries(
      Object.entries(acceptance).filter(([key]) => key !== "contentHash"),
    ) as Omit<BindingFunctionalAcceptance, "contentHash">;
    const body = {
      ...previous,
      acceptanceId: randomUUID(),
      outcome: "REJECTED" as const,
      acceptedAt: new Date().toISOString(),
      safeIssueCodes: ["ACCEPTANCE_REVOKED"],
    };
    await bindingRepository.appendFunctionalAcceptance({ ...body, contentHash: hash(body) });
  };
  return { pins, appendProbe, rejectAcceptance, probes, report: recorded.report };
}
