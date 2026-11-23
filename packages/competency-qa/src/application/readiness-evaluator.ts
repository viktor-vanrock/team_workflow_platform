import { defaultClassificationReferences } from "@awp/platform-contracts";

import type { QaContentHash, QaHumanActor, QaScope } from "../domain/primitives.ts";
import type { QaSemanticRef } from "../domain/qa-project-context.ts";
import type { QaRequestInputRevision } from "../domain/qa-request-input-revision.ts";
import {
  buildQaReadinessAssessment,
  type QaReadinessAssessment,
  type QaReadinessBlocker,
  qaReadinessInputFingerprint,
} from "../domain/readiness.ts";
import { DOR_RULE_CODES, qaDorRuleByCode } from "../rules/dor-rules.v1.ts";
import {
  type QaRetestLineageResolver,
  QaUs2RetestLineageResolver,
} from "./qa-retest-lineage-resolver.ts";

export { DOR_RULE_CODES } from "../rules/dor-rules.v1.ts";

export interface QaReadinessEvaluationInput {
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly extensionResourceVersion: number;
  readonly assessmentVersion?: number;
  readonly assessmentId?: string;
  readonly currentInput: QaRequestInputRevision;
  readonly acceptedRequest: Readonly<{
    exists: boolean;
    externalVersion?: string;
    normalizedStatus?: string;
  }>;
  readonly project: Readonly<{
    state: "ACTIVE" | "INACTIVE";
    registryState: "CURRENT" | "NEEDS_REVIEW";
    registryRevision: number;
  }>;
  readonly requesterEntitlement: Readonly<{ active: boolean; basisHash: QaContentHash }>;
  readonly mappingHealth: Readonly<{
    valid: boolean;
    bindingRef: { id: string; version: number };
    profileRef: { id: string; version: number };
    errors?: readonly string[];
  }>;
  readonly contextRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly dorRuleSetRef: QaSemanticRef;
  readonly allowedEnvironmentRefs: readonly Readonly<{ environmentId: string; revision: number }>[];
  readonly maximumClassificationKey: string;
  readonly evaluatedBy: QaHumanActor;
  readonly evaluatedAt: string;
}

const classificationRank = new Map<string, number>(
  defaultClassificationReferences.map(({ key, rank }) => [key, rank]),
);
const present = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

function blocker(code: string): QaReadinessBlocker {
  const rule = qaDorRuleByCode.get(code);
  if (!rule) throw new Error(`QA_DOR_RULE_NOT_REGISTERED:${code}`);
  return Object.freeze({
    code: rule.code,
    field: rule.field,
    pointer: rule.pointer,
    severity: "BLOCKING",
    remediation: rule.remediation,
    waivable: rule.waivable,
  });
}

export async function evaluateQaReadiness(
  input: QaReadinessEvaluationInput,
  lineageResolver: QaRetestLineageResolver = new QaUs2RetestLineageResolver(),
): Promise<QaReadinessAssessment> {
  const current = input.currentInput;
  const codes: string[] = [];
  if (!input.acceptedRequest.exists) codes.push("ACCEPTED_REQUEST_REQUIRED");
  if (input.project.state !== "ACTIVE") codes.push("PROJECT_INACTIVE");
  if (!input.requesterEntitlement.active) codes.push("REQUESTER_ENTITLEMENT_INACTIVE");
  const responseChannel =
    current.responseChannelResolution.state === "CONFIRMED"
      ? Object.freeze({
          state: "CONFIRMED" as const,
          requesterPrincipal: current.responseChannelResolution.requesterPrincipal,
          resolutionPolicyRef: current.responseChannelResolution.resolutionPolicyRef,
          evaluatedAt: current.responseChannelResolution.evaluatedAt,
          responseChannelRef: current.responseChannelResolution.responseChannelRef,
        })
      : Object.freeze({
          state: "UNCONFIRMED" as const,
          requesterPrincipal: current.responseChannelResolution.requesterPrincipal,
          resolutionPolicyRef: current.responseChannelResolution.resolutionPolicyRef,
          evaluatedAt: current.responseChannelResolution.evaluatedAt,
          missingReasonCode: current.responseChannelResolution.missingReasonCode,
        });
  if (responseChannel.state === "UNCONFIRMED") codes.push("RESPONSE_CHANNEL_UNCONFIRMED");
  if (!present(current.goal)) codes.push("GOAL_REQUIRED");
  if (!present(current.scope)) codes.push("VALIDATION_SCOPE_REQUIRED");
  if (!present(current.acceptanceOutcome)) codes.push("ACCEPTANCE_OUTCOME_REQUIRED");
  if (!current.blockersDeclared) codes.push("BLOCKERS_DECLARATION_REQUIRED");
  if (!current.dependenciesDeclared) codes.push("DEPENDENCIES_DECLARATION_REQUIRED");
  if (!current.sourceRefs?.length) codes.push("SOURCE_REFERENCE_REQUIRED");
  if (!current.requestedTarget?.buildRef) codes.push("BUILD_REFERENCE_REQUIRED");
  if (
    !current.requestedTarget?.environmentId ||
    !current.requestedTarget.environmentRevision ||
    !input.allowedEnvironmentRefs.some(
      (value) =>
        value.environmentId === current.requestedTarget!.environmentId &&
        value.revision === current.requestedTarget!.environmentRevision,
    )
  )
    codes.push("NON_PRODUCTION_TARGET_REQUIRED");
  if (!current.requestedTarget?.testDataRef && !current.requestedTarget?.accountLeaseRef)
    codes.push("TEST_DATA_REFERENCE_REQUIRED");
  if (!current.requestRisk) codes.push("REQUEST_RISK_REQUIRED");
  if (!present(current.desiredDate) || Number.isNaN(Date.parse(current.desiredDate!)))
    codes.push("DESIRED_DATE_REQUIRED");
  if (!current.checklistRefs?.length) codes.push("CHECKLIST_REFERENCE_REQUIRED");
  if (
    (classificationRank.get(current.dataClassificationKey) ?? Number.POSITIVE_INFINITY) >
    (classificationRank.get(input.maximumClassificationKey) ?? -1)
  )
    codes.push("CLASSIFICATION_NOT_ALLOWED");
  if (
    !input.mappingHealth.valid ||
    input.mappingHealth.bindingRef.id !== current.operationalBindingRef.id ||
    input.mappingHealth.bindingRef.version !== current.operationalBindingRef.version
  )
    codes.push("BINDING_PROFILE_MAPPING_INVALID");
  if (input.project.registryState === "NEEDS_REVIEW") codes.push("PROJECT_REGISTRY_NEEDS_REVIEW");
  if (current.requestKind === "retest") {
    if (!current.defectRef || !current.sourceBuildRef || !current.previousSessionRef)
      codes.push("RETEST_LINEAGE_REQUIRED");
    else if (!(await lineageResolver.resolve(input.scope, current.previousSessionRef)).valid)
      codes.push("RETEST_LINEAGE_INVALID");
  }
  const uniqueCodes = DOR_RULE_CODES.map(({ code }) => code).filter((code) => codes.includes(code));
  const blockers = Object.freeze(uniqueCodes.map(blocker));
  const fingerprint = qaReadinessInputFingerprint({
    currentInput: current,
    acceptedRequest: input.acceptedRequest,
    project: input.project,
    requesterEntitlement: input.requesterEntitlement,
    mappingHealth: input.mappingHealth,
    contextRef: input.contextRef,
    dorRuleSetRef: input.dorRuleSetRef,
  });
  return buildQaReadinessAssessment({
    assessmentId:
      input.assessmentId ??
      `readiness:${input.workItemId}:${input.assessmentVersion ?? current.version}:${fingerprint.slice(-12)}`,
    version: input.assessmentVersion ?? current.version,
    scope: input.scope,
    workItemId: input.workItemId,
    requestInputRevisionRef: {
      id: current.inputRevisionId,
      version: current.version,
      contentHash: current.contentHash,
    },
    extensionResourceVersion: input.extensionResourceVersion,
    state: blockers.length === 0 ? "READY" : "NEEDS_INFO",
    inputFingerprint: fingerprint,
    contextRef: input.contextRef,
    dorRuleSetRef: input.dorRuleSetRef,
    inputs: Object.freeze({
      acceptedRequest: structuredClone(input.acceptedRequest),
      project: structuredClone(input.project),
      requesterEntitlement: structuredClone(input.requesterEntitlement),
      mappingHealth: structuredClone(input.mappingHealth),
      responseChannel,
    }),
    blockers,
    warnings: Object.freeze([]),
    acknowledgements: Object.freeze([]),
    waivedRuleCodes: Object.freeze([]),
    evaluatedBy: input.evaluatedBy,
    evaluatedAt: input.evaluatedAt,
  });
}
