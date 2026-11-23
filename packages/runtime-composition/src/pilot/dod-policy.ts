import type { EntityManager } from "typeorm";

import {
  qaAggregateSnapshotHash,
  qaDodRulesV1,
  qaEvidencePolicyV1,
  type QaProjectContext,
  type QaRequestExtension,
  type QaRiskReviewPolicy,
  type QaScope,
} from "@awp/competency-qa/node";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
} from "@awp/platform-core";

import type { QaDodPolicy, QaDodPolicyPort } from "./dod-runtime.ts";

export const compiledQaDodPolicyRefs = Object.freeze({
  rules: Object.freeze({
    key: "qa.dod",
    version: "1.0.0",
    contentHash: qaAggregateSnapshotHash(qaDodRulesV1 as never),
  }),
  evidence: Object.freeze({
    key: "qa.evidence",
    version: "1.0.0",
    contentHash: qaAggregateSnapshotHash(qaEvidencePolicyV1 as never),
  }),
});
export interface QaDodPolicyPins extends QaScope {
  readonly contextRef: ExactRevisionRef;
  readonly riskPolicyRef: ExactRevisionRef;
}
const same = (a: unknown, b: unknown) =>
  qaAggregateSnapshotHash(a as never) === qaAggregateSnapshotHash(b as never);

/** Exact published policy heads are locked for the decision transaction; unknown dialects fail closed. */
export class PublishedQaDodPolicy implements QaDodPolicyPort {
  readonly #pins: readonly QaDodPolicyPins[];
  constructor(pins: readonly QaDodPolicyPins[]) {
    if (
      !pins.length ||
      pins.length > 100 ||
      new Set(pins.map((pin) => `${pin.workspaceId}:${pin.projectId}`)).size !== pins.length
    )
      throw new Error("QA_DOD_POLICY_CONFIGURATION_INVALID");
    for (const pin of pins) {
      if (!pin.workspaceId || !pin.projectId)
        throw new Error("QA_DOD_POLICY_CONFIGURATION_INVALID");
      assertExactRevisionRef(pin.contextRef);
      assertExactRevisionRef(pin.riskPolicyRef);
    }
    this.#pins = freezePilotValue(structuredClone(pins));
  }
  async load(
    manager: EntityManager,
    scope: QaScope,
    extension: QaRequestExtension,
  ): Promise<QaDodPolicy> {
    const denied = () => new Error("QA_DOD_POLICY_NOT_CURRENT");
    const pin = this.#pins.find(
      (value) => value.workspaceId === scope.workspaceId && value.projectId === scope.projectId,
    );
    if (
      !pin ||
      extension.workspaceId !== scope.workspaceId ||
      extension.projectId !== scope.projectId ||
      !same(extension.projectContextRef, pin.contextRef) ||
      !same(extension.riskReviewPolicyRef, pin.riskPolicyRef)
    )
      throw denied();
    const args = [scope.workspaceId, scope.projectId];
    const [contextRow] = (await manager.query(
      `SELECT v.version,v.content_hash,v.content FROM qa_project_contexts h JOIN qa_project_context_versions v
      ON v.id=h.current_published_version_id AND v.header_id=h.id AND v.workspace_id=h.workspace_id AND v.project_id=h.project_id
      WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.id=$3 FOR SHARE OF h`,
      [...args, pin.contextRef.id],
    )) as { version: number; content_hash: string; content: QaProjectContext }[];
    const [riskRow] = (await manager.query(
      `SELECT v.version,v.content_hash,v.content FROM qa_risk_review_policies h JOIN qa_risk_review_policy_versions v
      ON v.id=h.current_published_version_id AND v.header_id=h.id AND v.workspace_id=h.workspace_id AND v.project_id=h.project_id
      WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.id=$3 FOR SHARE OF h`,
      [...args, pin.riskPolicyRef.id],
    )) as { version: number; content_hash: string; content: QaRiskReviewPolicy }[];
    if (
      !contextRow ||
      !riskRow ||
      contextRow.version !== pin.contextRef.version ||
      contextRow.content_hash !== pin.contextRef.contentHash ||
      riskRow.version !== pin.riskPolicyRef.version ||
      riskRow.content_hash !== pin.riskPolicyRef.contentHash
    )
      throw denied();
    const { contentHash: contextHash, ...context } = contextRow.content;
    const { contentHash: riskHash, ...risk } = riskRow.content;
    if (
      context.schemaVersion !== 1 ||
      context.state !== "PUBLISHED" ||
      context.contextId !== pin.contextRef.id ||
      context.version !== pin.contextRef.version ||
      context.workspaceId !== scope.workspaceId ||
      context.projectId !== scope.projectId ||
      risk.policyId !== pin.riskPolicyRef.id ||
      risk.version !== pin.riskPolicyRef.version ||
      risk.workspaceId !== scope.workspaceId ||
      risk.projectId !== scope.projectId ||
      contextHash !== pin.contextRef.contentHash ||
      qaAggregateSnapshotHash(context as never) !== contextHash ||
      riskHash !== pin.riskPolicyRef.contentHash ||
      qaAggregateSnapshotHash(risk as never) !== riskHash ||
      !same(context.riskReviewPolicyRef, pin.riskPolicyRef)
    )
      throw denied();
    if (
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(context.projectRisk) ||
      risk.schemaVersion !== 1 ||
      !same(context.dodRuleSetRef, compiledQaDodPolicyRefs.rules) ||
      !same(extension.dodRuleSetRef, compiledQaDodPolicyRefs.rules) ||
      !same(context.evidencePolicyRef, compiledQaDodPolicyRefs.evidence) ||
      !same(extension.evidencePolicyRef, compiledQaDodPolicyRefs.evidence) ||
      !same(risk.ordinaryVerdict, { requiredSignerRole: "QA_EXECUTOR", minimumSignatures: 1 }) ||
      !same(risk.elevatedVerdict, {
        riskLevels: ["HIGH", "CRITICAL"],
        primarySignerRole: "QA_EXECUTOR",
        coSignerRole: "QA_LEAD",
        distinctActorRequired: true,
      })
    )
      throw new Error("QA_DOD_POLICY_UNSUPPORTED");
    return {
      rules: {
        id: compiledQaDodPolicyRefs.rules.key,
        version: 1,
        contentHash: compiledQaDodPolicyRefs.rules.contentHash,
      },
      riskPolicyRef: pin.riskPolicyRef,
      evidencePolicyRef: compiledQaDodPolicyRefs.evidence,
      minimumEffectiveRisk:
        context.projectRisk === "HIGH" || context.projectRisk === "CRITICAL"
          ? context.projectRisk
          : "ORDINARY",
      maximumClassificationKey: context.maximumClassificationKey,
    };
  }
}
