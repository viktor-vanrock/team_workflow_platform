import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import {
  bindingRevision,
  configurationFacts,
} from "../../apps/api/src/extensions/onboarding/binding-facts.ts";
import {
  currentAuthority,
  digest,
  ref,
} from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  ManageAutomationSuiteService,
  type QaAutomationSuiteContent,
  qaAutomationSuiteValidationCheckOrder,
  recordAutomationSuiteValidation,
  TypeOrmAutomationSuiteRepository,
} from "../../packages/competency-qa/src/node.ts";
import type { ExactRevisionRef } from "../../packages/platform-core/src/index.ts";
import { qaAutomationProfilePinSetHash } from "../../packages/runtime-composition/src/pilot/automation-availability.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import type { startBindingHttpFixture } from "./007-binding-http-fixture.ts";

type Fixture = Awaited<ReturnType<typeof startBindingHttpFixture>>;
/** Real resource HTTP writes and Suite persistence with a controlled validator; no external conformance claim. */
export async function publishFullQaResources(f: Fixture) {
  const policy = ref("controlled-policy", 1, digest({ policy: "local" })),
    ownerPrincipalId = localPersonaIds["lead.alpha"];
  const configuration = {
    key: "local-environment",
    schemaRef: { id: "controlled-schema", version: 1, digest: digest({ type: "object" }) },
    resourceRef: ref("local-runtime", 1, digest({ local: true })),
  };
  const send = async (path: string, body: unknown) => {
    const response = await f.send(path, body, randomUUID(), 1);
    expect(response).toMatchObject({ status: 201 });
    return response.body.resultRef;
  };
  const environmentRef = await send("qa/environments", {
    environmentId: randomUUID(),
    key: "local-full-qa",
    name: "Local full QA",
    scope: "LOCAL",
    ownerPrincipalId,
    dataClassificationKey: "INTERNAL",
    configurationRef: configuration,
    allowedTestDataPolicyRefs: [policy],
    reason: "Local full QA journey",
  });
  const dataset = await send("qa/resources/test-data", {
    kind: "DATASET",
    resourceId: randomUUID(),
    externalRef: ref("dataset", 1, digest({ local: true })),
    ownerPrincipalId,
    allowedEnvironmentRefs: [environmentRef],
    dataClassificationKey: "INTERNAL",
    retentionPolicyRef: policy,
  });
  const inventory = {
    id: "local-http-accounts",
    version: 1,
    ...f.scope,
    opaqueAccountRefs: ["accountref://controlled/account-1"],
  };
  const pool = await send("qa/resources/account-pools", {
    kind: "ACCOUNT_POOL",
    resourceId: randomUUID(),
    environmentRef,
    resolverRef: {
      ...configuration,
      key: "file-account-inventory",
      resourceRef: ref(inventory.id, 1, digest(inventory)),
    },
    ownerPrincipalId,
    maximumConcurrentLeases: 1,
    maximumLeaseDurationSeconds: 300,
    dataClassificationKey: "INTERNAL",
  });
  const contextRef = await send("qa/context", {
    environmentRefs: [environmentRef],
    testDataCatalogRefs: [dataset],
    accountPoolRefs: [pool],
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
    reason: "Local full QA context",
  });
  return { environmentRef, contextRef, policy };
}
export async function publishFullQaSuite(
  f: Fixture,
  bindingRef: ExactRevisionRef,
  resources: Awaited<ReturnType<typeof publishFullQaResources>>,
) {
  const config = await f.source.transaction(async (manager) => {
    const binding = await bindingRevision(manager, f.scope, bindingRef),
      refs = await configurationFacts(manager, f.scope, binding);
    const entries = binding.content.entries as {
      logicalRole: string;
      capabilityKey: string;
      profileRef: ExactRevisionRef;
    }[];
    const roles = [];
    for (const logicalRole of ["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"] as const) {
      const entry = entries.find(
        (e) => e.logicalRole === logicalRole && e.capabilityKey !== "operational-work-item",
      )!;
      const profileRef = refs.find((r) => r.id === entry.profileRef.id)!;
      const [profile] = (await manager.query(
        "SELECT content FROM connector_profile_revisions WHERE header_id=$1 AND version=$2",
        [profileRef.id, profileRef.version],
      )) as { content: { connectionRef: ExactRevisionRef } }[];
      roles.push({
        logicalRole,
        profileRef,
        connectionRef: refs.find((r) => r.id === profile!.content.connectionRef.id)!,
      });
    }
    return roles;
  });
  const authority = await f.source.transaction((manager) =>
    currentAuthority(
      manager,
      { kind: "PROJECT", ...f.scope },
      localPersonaIds["lead.alpha"],
      "integration.accept",
      "qa-lead",
    ),
  );
  const pinSet = { ...f.scope, bindingRef, roles: config, environmentScope: "LOCAL" as const };
  const profilePinSetHash = qaAutomationProfilePinSetHash(pinSet),
    at = new Date().toISOString(),
    exact = () => ref(randomUUID(), 1, digest({ controlled: true }));
  const content: QaAutomationSuiteContent = {
    ownerPrincipalId: authority.actor.principalId,
    suiteDefinitionRef: exact(),
    logicalExecutionContract: {
      pipelineKey: "qa.validation",
      sourceRefPolicyRef: "source-policy@1",
      resultJobKey: "machine-result",
      contractHash: digest({ pipeline: "local" }),
    },
    allowedTargetTypes: ["MERGE_REQUEST", "COMMIT", "BUILD"],
    allowedEnvironmentRefs: [`${resources.environmentRef.id}@${resources.environmentRef.version}`],
    parameterSchemaRef: exact(),
    resultSchemaRef: exact(),
    artifactPolicyRef: resources.policy,
    retryPolicyRef: exact(),
    quarantinePolicyRef: exact(),
    capabilityRequirements: [
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ],
  };
  const created = await f.source.transaction((manager) =>
    new ManageAutomationSuiteService(new TypeOrmAutomationSuiteRepository(manager)).create({
      id: randomUUID(),
      scope: f.scope,
      suiteKey: `suite-${randomUUID()}`,
      content,
      actor: authority.actor,
      createdAt: at,
    }),
  );
  const recorded = recordAutomationSuiteValidation(created.version, {
    id: randomUUID(),
    ...f.scope,
    suiteBindingRef: ref(created.version.id, 1, created.version.contentHash),
    status: "VALID",
    coreBindingRef: bindingRef,
    profilePinSetHash,
    discoverySnapshotRef: "controlled-local-discovery",
    discoverySnapshotHash: digest({ discovery: "local" }),
    suiteProbeRef: "controlled-local-suite",
    suiteProbeHash: digest({ probe: "local" }),
    checks: qaAutomationSuiteValidationCheckOrder.map((key) => ({ key, passed: true })),
    issues: [],
    validatedBy: {
      kind: "SERVICE",
      principalId: "controlled-validator",
      serviceKey: "suite-validation",
    },
    authorizationBasisHash: digest(authority.basis),
    createdAt: at,
  });
  await f.source.transaction(async (manager) => {
    const repository = new TypeOrmAutomationSuiteRepository(manager);
    await repository.persistValidation({
      scope: f.scope,
      previousVersion: created.version,
      nextVersion: recorded.version,
      report: recorded.report,
    });
    await new ManageAutomationSuiteService(repository).publish({
      scope: f.scope,
      header: created.header,
      versions: [recorded.version],
      reports: [recorded.report],
      versionId: recorded.version.id,
      expectedResourceVersion: created.header.resourceVersion,
      evidence: {
        coreBindingRef: bindingRef,
        profilePinSetHash,
        discoverySnapshotHash: recorded.report.discoverySnapshotHash,
        suiteProbeHash: recorded.report.suiteProbeHash,
        discoveryCurrent: true,
        nonProduction: true,
        noDeploySurface: true,
      },
      publishedAt: at,
    });
  });
  return {
    suiteRef: ref(recorded.version.id, 1, recorded.version.contentHash),
    reportRef: ref(recorded.report.id, 1, recorded.report.contentHash),
    header: created.header,
    report: recorded.report,
    roles: config,
  };
}
