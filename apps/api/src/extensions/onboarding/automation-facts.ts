import type { EntityManager } from "typeorm";

import { qaValidationCapabilityRequirementSetV1 } from "@awp/competency-qa/node";
import type { ExactRevisionRef, ProjectOnboardingRevision } from "@awp/platform-core";
import {
  type QaAutomationAvailabilityPins,
  type QaPublishedSuitePins,
  readPublishedQaAutomationFacts,
  readPublishedQaAutomationSuite,
} from "@awp/runtime-composition";

import { type BindingRevision, configurationFacts } from "./binding-facts.ts";
import { exact, ref, reject, same, validHash } from "./durable-http.ts";

type Document = Record<string, unknown>;
const doc = (v: unknown): Document => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return reject("AUTOMATION_CONFIGURATION_UNAVAILABLE", 409);
  return v as Document;
};
const refs = (v: unknown) => {
  if (!Array.isArray(v)) return reject("AUTOMATION_CONFIGURATION_UNAVAILABLE", 409);
  return v.map(exact);
};

/** Resolve only current published Suite revisions explicitly named by QA acceptance. */
export async function acceptedSuitePins(
  manager: EntityManager,
  current: ProjectOnboardingRevision,
  target: ExactRevisionRef,
  binding: BindingRevision,
  context: Document,
  accepted: readonly ExactRevisionRef[],
): Promise<QaPublishedSuitePins[]> {
  const configuration = await configurationFacts(manager, current, binding),
    entries = binding.content.entries as Document[];
  const requirements = qaValidationCapabilityRequirementSetV1.requirements.filter(
    (r) => r.mode === "AUTOMATION",
  );
  const roles: QaAutomationAvailabilityPins["roles"][number][] = [],
    environments = new Set<string>();
  for (const requirement of requirements) {
    const selected = entries.filter(
      (e) =>
        e.logicalRole === requirement.logicalRole &&
        e.capabilityKey === requirement.capabilityKey &&
        e.exactContractVersion === requirement.exactContractVersion,
    );
    if (selected.length !== 1) return reject("AUTOMATION_CONFIGURATION_UNAVAILABLE", 409);
    const entry = selected[0]!,
      profileRef = configuration.find(
        (r) => r.id === doc(entry.profileRef).id && r.version === doc(entry.profileRef).version,
      );
    if (!profileRef) return reject("AUTOMATION_CONFIGURATION_UNAVAILABLE", 409);
    const [profile] = (await manager.query(
      "SELECT content FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3",
      [current.workspaceId, profileRef.id, profileRef.version],
    )) as { content: Document }[];
    const connectionRef = configuration.find(
      (r) =>
        r.id === doc(profile?.content.connectionRef).id &&
        r.version === doc(profile?.content.connectionRef).version,
    );
    if (!connectionRef) return reject("AUTOMATION_CONFIGURATION_UNAVAILABLE", 409);
    roles.push({
      logicalRole:
        requirement.logicalRole as QaAutomationAvailabilityPins["roles"][number]["logicalRole"],
      profileRef,
      connectionRef,
    });
    environments.add(String(entry.environmentScope));
  }
  const environmentScope = [...environments][0];
  if (
    roles.length !== 3 ||
    environments.size !== 1 ||
    (environmentScope !== "LOCAL" && environmentScope !== "NON_PROD")
  )
    return reject("AUTOMATION_ENVIRONMENT_INVALID", 409);
  const evidencePolicyRef = exact(context.evidencePolicyRef),
    contextEnvironments = refs(context.environmentRefs);
  const suites = (await manager.query(
    `SELECT h.suite_binding_id,v.suite_binding_version_id,v.version,v.content_hash,v.content,v.validation_report_id,v.validation_report_content_hash
    FROM qa_automation_suite_bindings h JOIN qa_automation_suite_binding_versions v ON v.workspace_id=h.workspace_id AND v.project_id=h.project_id AND v.suite_binding_id=h.suite_binding_id AND v.suite_binding_version_id=h.current_published_version_id AND v.version=h.current_published_version
    WHERE h.workspace_id=$1 AND h.project_id=$2 AND v.state='PUBLISHED' AND v.suite_binding_version_id=ANY($3::text[]) FOR SHARE OF h,v`,
    [current.workspaceId, current.projectId, accepted.map((r) => r.id)],
  )) as {
    suite_binding_id: string;
    suite_binding_version_id: string;
    version: number;
    content_hash: `sha256:${string}`;
    content: Document;
    validation_report_id: string;
    validation_report_content_hash: `sha256:${string}`;
  }[];
  const known = [
    ...configuration,
    evidencePolicyRef,
    ...[
      "environmentRefs",
      "testDataCatalogRefs",
      "accountPoolRefs",
      "targetPolicyRefs",
      "scopePolicyRefs",
      "checklistPolicyRefs",
    ].flatMap((k) => (Array.isArray(context[k]) ? refs(context[k]) : [])),
  ];
  const suiteRefs = accepted.filter((r) => !known.some((a) => same(a, r)));
  if (
    !suiteRefs.length ||
    suiteRefs.some(
      (r) =>
        !suites.some((s) => same(r, ref(s.suite_binding_version_id, s.version, s.content_hash))),
    )
  )
    return reject("AUTOMATION_SUITE_STALE", 409);
  const result: QaPublishedSuitePins[] = [];
  for (const suite of suites) {
    const suiteRef = ref(suite.suite_binding_version_id, suite.version, suite.content_hash);
    if (!accepted.some((r) => same(r, suiteRef))) return reject("AUTOMATION_SUITE_STALE", 409);
    const environments = contextEnvironments.filter(
      (r) =>
        accepted.some((a) => same(a, r)) &&
        Array.isArray(suite.content.allowedEnvironmentRefs) &&
        suite.content.allowedEnvironmentRefs.includes(`${r.id}@${r.version}`),
    );
    if (!environments.length || !accepted.some((r) => same(r, evidencePolicyRef)))
      return reject("AUTOMATION_ACCEPTANCE_INCOMPLETE", 409);
    for (const environmentRef of environments) {
      const [environment] = (await manager.query(
        `SELECT r.semantic_body,r.content_hash FROM qa_project_environment_headers h JOIN qa_project_environment_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.environment_id=h.environment_id AND r.version=h.current_published_version
        WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.environment_id=$3 AND r.version=$4 AND r.state='PUBLISHED' FOR SHARE OF h,r`,
        [current.workspaceId, current.projectId, environmentRef.id, environmentRef.version],
      )) as { semantic_body: Document; content_hash: string }[];
      if (
        !environment ||
        environment.content_hash !== environmentRef.contentHash ||
        !validHash(environment.semantic_body as { contentHash: string }) ||
        environment.semantic_body.scope !== environmentScope
      )
        return reject("AUTOMATION_ENVIRONMENT_STALE", 409);
      const pin: QaPublishedSuitePins = {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        bindingRef: target,
        roles,
        environmentScope,
        suiteBindingId: suite.suite_binding_id,
        suiteRef,
        suiteValidationRef: ref(
          suite.validation_report_id,
          1,
          suite.validation_report_content_hash,
        ),
        environmentRef,
        evidencePolicyRef,
        maximumEvidenceAgeMs: 600_000,
      };
      await readPublishedQaAutomationSuite(manager, pin);
      result.push(pin);
    }
  }
  return result;
}
export async function automationObservations(
  manager: EntityManager,
  current: ProjectOnboardingRevision,
  target: ExactRevisionRef,
  binding: BindingRevision,
  validationRef: ExactRevisionRef,
) {
  const unavailable = {
    refs: [] as ExactRevisionRef[],
    safeIssueCodes: ["AUTOMATION_CONFIGURATION_UNAVAILABLE"],
    validUntil: Date.now() + 60_000,
  };
  try {
    const [context] = (await manager.query(
      "SELECT semantic_body FROM qa_project_context_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND context_id=$3 AND version=$4",
      [
        current.workspaceId,
        current.projectId,
        current.qaProjectContextRef!.id,
        current.qaProjectContextRef!.version,
      ],
    )) as { semantic_body: Document }[];
    const [acceptance] = (await manager.query(
      "SELECT semantic_body FROM binding_functional_acceptances WHERE workspace_id=$1 AND project_id=$2 AND binding_ref->>'id'=$3 ORDER BY accepted_at DESC,acceptance_id DESC LIMIT 1",
      [current.workspaceId, current.projectId, target.id],
    )) as { semantic_body: Document }[];
    const a = doc(acceptance?.semantic_body),
      pins = await acceptedSuitePins(
        manager,
        current,
        target,
        binding,
        doc(context?.semantic_body),
        refs(a.acceptedResourceRefs),
      );
    if (!pins.length) return unavailable;
    // Each accepted Suite/environment must still be valid. A stale accepted pin cannot fall back to another Suite.
    const evidence: ExactRevisionRef[] = [],
      issues: string[] = [],
      expiries: number[] = [];
    for (const pin of pins) {
      const facts = await readPublishedQaAutomationFacts(
        manager,
        {
          ...pin,
          contextRef: current.qaProjectContextRef!,
          bindingValidationRef: validationRef,
          acceptanceRef: exact({
            id: a.acceptanceId,
            version: a.version,
            contentHash: a.contentHash,
          }),
        },
        AbortSignal.timeout(2000),
      );
      if (!facts.operationallyActive) return unavailable;
      if (facts.projection.liveAvailability !== "AVAILABLE")
        issues.push("AUTOMATION_CAPABILITY_UNAVAILABLE");
      evidence.push(...facts.evidenceRefs);
      expiries.push(facts.validUntil);
    }
    return {
      refs: [...new Map(evidence.map((r) => [`${r.id}:${r.version}`, r])).values()],
      safeIssueCodes: [...new Set(issues)],
      validUntil: Math.min(...expiries),
    };
  } catch (error) {
    // A SQL error aborts the transaction and must retain its conflict/unavailability semantics.
    if (error && typeof error === "object" && "driverError" in error) throw error;
    return unavailable;
  }
}
