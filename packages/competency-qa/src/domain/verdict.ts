import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "./primitives.ts";

export type QaVerdictValue = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE";
export type QaEffectiveRisk = "ORDINARY" | "HIGH" | "CRITICAL";
export type QaVerdictState = "DRAFT" | "PARTIALLY_SIGNED" | "SIGNED" | "SUPERSEDED";
export type QaVerdictSignatureRole = "PRIMARY" | "LEAD_COSIGN";

export interface QaResidualRisk {
  readonly statement: string;
  readonly classification: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface QaVerdictSignature {
  readonly signatureId: string;
  readonly role: QaVerdictSignatureRole;
  readonly verdictContentHash: QaContentHash;
  readonly signer: QaHumanActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly actionRef?: QaExactReference;
  readonly signedAt: string;
}

export interface QaVerdictInput {
  readonly verdictId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly verdict: QaVerdictValue;
  readonly residualRisk: QaResidualRisk;
  readonly effectiveRisk: QaEffectiveRisk;
  readonly requiredSessionPlanRef: QaExactReference;
  readonly sessionReviewRefs: readonly QaExactReference[];
  readonly evidenceManifestRefs: readonly QaExactReference[];
  readonly findingOutcomeRefs: readonly QaExactReference[];
  readonly dodRuleSetRef: QaExactReference;
  readonly riskPolicyRef: QaExactReference;
  readonly aggregateSnapshotHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly supersedesVerdictRef?: QaExactReference;
  readonly revisionReason?: string;
}

function assertExactSet(refs: readonly QaExactReference[], code: string): void {
  const keys = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.id}:${ref.version}:${ref.contentHash}`;
    if (!ref.id || ref.version < 1 || !ref.contentHash.startsWith("sha256:") || keys.has(key)) {
      throw new QaDomainError(code);
    }
    keys.add(key);
  }
}

export class QaVerdictAggregate {
  readonly verdictId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly verdict: QaVerdictValue;
  readonly residualRisk: QaResidualRisk;
  readonly effectiveRisk: QaEffectiveRisk;
  readonly requiredSessionPlanRef: QaExactReference;
  readonly sessionReviewRefs: readonly QaExactReference[];
  readonly evidenceManifestRefs: readonly QaExactReference[];
  readonly findingOutcomeRefs: readonly QaExactReference[];
  readonly dodRuleSetRef: QaExactReference;
  readonly riskPolicyRef: QaExactReference;
  readonly aggregateSnapshotHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly supersedesVerdictRef?: QaExactReference;
  readonly revisionReason?: string;
  readonly contentHash: QaContentHash;
  readonly signatures: QaVerdictSignature[] = [];
  state: QaVerdictState = "DRAFT";
  signedAt?: string;
  supersededByVerdictRef?: QaExactReference;
  supersessionReason?: string;
  supersededAt?: string;
  resourceVersion = 1;

  constructor(input: QaVerdictInput) {
    if (
      !input.verdictId ||
      !input.workspaceId ||
      !input.projectId ||
      !input.workItemId ||
      input.version < 1 ||
      !input.residualRisk.statement.trim() ||
      Number.isNaN(Date.parse(input.createdAt)) ||
      (input.version === 1 &&
        (input.supersedesVerdictRef !== undefined || input.revisionReason !== undefined)) ||
      (input.version > 1 &&
        (input.supersedesVerdictRef === undefined || !input.revisionReason?.trim()))
    )
      throw new QaDomainError("QA_VERDICT_INPUT_INVALID");
    assertExactSet(input.sessionReviewRefs, "QA_VERDICT_SESSION_REFS_INVALID");
    assertExactSet(input.evidenceManifestRefs, "QA_VERDICT_EVIDENCE_REFS_INVALID");
    assertExactSet(input.findingOutcomeRefs, "QA_VERDICT_FINDING_REFS_INVALID");
    if (input.sessionReviewRefs.length === 0 || input.evidenceManifestRefs.length === 0) {
      throw new QaDomainError("QA_VERDICT_INVENTORY_INCOMPLETE");
    }
    Object.assign(this, structuredClone(input));
    this.verdictId = input.verdictId;
    this.version = input.version;
    this.workspaceId = input.workspaceId;
    this.projectId = input.projectId;
    this.workItemId = input.workItemId;
    this.verdict = input.verdict;
    this.residualRisk = Object.freeze(structuredClone(input.residualRisk));
    this.effectiveRisk = input.effectiveRisk;
    this.requiredSessionPlanRef = Object.freeze(structuredClone(input.requiredSessionPlanRef));
    this.sessionReviewRefs = Object.freeze(structuredClone(input.sessionReviewRefs));
    this.evidenceManifestRefs = Object.freeze(structuredClone(input.evidenceManifestRefs));
    this.findingOutcomeRefs = Object.freeze(structuredClone(input.findingOutcomeRefs));
    this.dodRuleSetRef = Object.freeze(structuredClone(input.dodRuleSetRef));
    this.riskPolicyRef = Object.freeze(structuredClone(input.riskPolicyRef));
    this.aggregateSnapshotHash = input.aggregateSnapshotHash;
    this.createdBy = Object.freeze(structuredClone(input.createdBy));
    this.createdAt = input.createdAt;
    if (input.supersedesVerdictRef !== undefined)
      this.supersedesVerdictRef = Object.freeze(structuredClone(input.supersedesVerdictRef));
    if (input.revisionReason !== undefined) this.revisionReason = input.revisionReason;
    this.contentHash = qaAggregateSnapshotHash({
      verdictId: this.verdictId,
      version: this.version,
      workspaceId: this.workspaceId,
      projectId: this.projectId,
      workItemId: this.workItemId,
      verdict: this.verdict,
      residualRisk: this.residualRisk,
      effectiveRisk: this.effectiveRisk,
      requiredSessionPlanRef: this.requiredSessionPlanRef,
      sessionReviewRefs: this.sessionReviewRefs,
      evidenceManifestRefs: this.evidenceManifestRefs,
      findingOutcomeRefs: this.findingOutcomeRefs,
      dodRuleSetRef: this.dodRuleSetRef,
      riskPolicyRef: this.riskPolicyRef,
      aggregateSnapshotHash: this.aggregateSnapshotHash,
      supersedesVerdictRef: this.supersedesVerdictRef ?? null,
      revisionReason: this.revisionReason ?? null,
    } as never);
  }

  get ref(): QaExactReference {
    return Object.freeze({
      id: this.verdictId,
      version: this.version,
      contentHash: this.contentHash,
    });
  }

  matchesAggregate(hash: QaContentHash): boolean {
    return this.aggregateSnapshotHash === hash;
  }

  addSignature(signature: QaVerdictSignature): void {
    if (this.state === "SIGNED" || this.state === "SUPERSEDED")
      throw new QaDomainError("QA_VERDICT_SIGNATURE_STATE_INVALID");
    if (signature.verdictContentHash !== this.contentHash)
      throw new QaDomainError("QA_VERDICT_SIGNATURE_STALE");
    if (
      this.signatures.some(
        ({ role, signer }) =>
          role === signature.role || signer.principalId === signature.signer.principalId,
      )
    ) {
      throw new QaDomainError("QA_VERDICT_SIGNATURE_DUPLICATE");
    }
    if (signature.role === "PRIMARY") {
      if (this.signatures.length !== 0) throw new QaDomainError("QA_VERDICT_PRIMARY_ORDER_INVALID");
      this.signatures.push(Object.freeze(structuredClone(signature)));
      if (this.effectiveRisk === "ORDINARY") {
        this.state = "SIGNED";
        this.signedAt = signature.signedAt;
      } else {
        this.state = "PARTIALLY_SIGNED";
      }
    } else {
      const primary = this.signatures.find(({ role }) => role === "PRIMARY");
      if (this.state !== "PARTIALLY_SIGNED" || primary === undefined)
        throw new QaDomainError("QA_VERDICT_COSIGN_STATE_INVALID");
      if (primary.signer.principalId === signature.signer.principalId)
        throw new QaDomainError("QA_VERDICT_COSIGN_DISTINCT_ACTOR_REQUIRED");
      this.signatures.push(Object.freeze(structuredClone(signature)));
      this.state = "SIGNED";
      this.signedAt = signature.signedAt;
    }
    this.resourceVersion += 1;
  }

  markSuperseded(
    input: Readonly<{ successorRef: QaExactReference; reason: string; at: string }>,
  ): void {
    if (this.state !== "SIGNED" || !input.reason.trim() || Number.isNaN(Date.parse(input.at))) {
      throw new QaDomainError("QA_VERDICT_SUPERSESSION_INVALID");
    }
    this.state = "SUPERSEDED";
    this.supersededByVerdictRef = Object.freeze(structuredClone(input.successorRef));
    this.supersessionReason = input.reason;
    this.supersededAt = input.at;
    this.resourceVersion += 1;
  }
}
