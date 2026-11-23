import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";
import type {
  ConfirmedJiraProjectionRef,
  JiraStatusMappingRef,
  QueueVersionedContentRef,
  ResourceScope,
  SlaGoal,
} from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type ProjectScope = Extract<ResourceScope, { kind: "PROJECT" }>;
type Row = Record<string, unknown>;

const rows = (value: unknown): readonly Row[] => {
  const candidate = value as readonly unknown[];
  return (Array.isArray(candidate?.[0]) ? candidate[0] : candidate) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export interface SlaRolloutAuthorityVerificationReceipt {
  readonly schemaVersion: "sla-rollout-authority-verification@1.0.0";
  readonly receiptId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly goal: SlaGoal;
  readonly policyEnableEpochRef: QueueVersionedContentRef;
  readonly policyFacetRef: QueueVersionedContentRef;
  readonly calendarRef: QueueVersionedContentRef;
  readonly mappingRef: JiraStatusMappingRef;
  readonly operationalProjectionRef: ConfirmedJiraProjectionRef;
  readonly externalRevisionToken: string;
  readonly authorityFieldsHash: Sha256Digest;
  readonly observedNormalizedStatus: string;
  readonly providerObservedAt: string;
  readonly verifierRunRef: QueueVersionedContentRef;
  readonly reducerDisposition: "DUPLICATE";
  readonly confirmedAt: string;
  readonly semanticHash: Sha256Digest;
}

function assertReceipt(value: SlaRolloutAuthorityVerificationReceipt, scope: ProjectScope): void {
  const { semanticHash: _semanticHash, ...body } = value;
  void _semanticHash;
  const hashes = [
    value.policyEnableEpochRef.semanticHash,
    value.policyFacetRef.semanticHash,
    value.calendarRef.semanticHash,
    value.mappingRef.semanticHash,
    value.operationalProjectionRef.semanticHash,
    value.authorityFieldsHash,
    value.verifierRunRef.semanticHash,
    value.semanticHash,
  ];
  if (
    value.schemaVersion !== "sla-rollout-authority-verification@1.0.0" ||
    value.workspaceId !== scope.workspaceId ||
    value.projectId !== scope.projectId ||
    !value.receiptId ||
    !value.workItemId ||
    !new Set<SlaGoal>(["READY_TO_FIRST_QA_START", "READY_TO_SIGNED_VERDICT"]).has(value.goal) ||
    value.mappingRef.sourceType !== "JIRA_STATUS_MAPPING_REVISION" ||
    value.operationalProjectionRef.sourceType !== "JIRA_OPERATIONAL_PROJECTION_REVISION" ||
    value.reducerDisposition !== "DUPLICATE" ||
    !value.externalRevisionToken ||
    !value.observedNormalizedStatus ||
    hashes.some((hash) => !/^sha256:[a-f0-9]{64}$/u.test(hash)) ||
    !Number.isFinite(Date.parse(value.providerObservedAt)) ||
    !Number.isFinite(Date.parse(value.confirmedAt)) ||
    Date.parse(value.confirmedAt) < Date.parse(value.providerObservedAt) ||
    value.semanticHash !== sha256(body as unknown as JsonValue)
  ) {
    throw new Error("SLA_ROLLOUT_RECEIPT_INVALID");
  }
}

/** Immutable one-per Work Item/goal/policy-enable-epoch verification receipts. */
export class SlaRolloutVerificationRepository extends ScopedRepositoryBase {
  async currentForEpoch(
    input: Readonly<{
      scope: ProjectScope;
      workItemId: string;
      goal: SlaGoal;
      policyEnableEpochHash: Sha256Digest;
    }>,
  ): Promise<SlaRolloutAuthorityVerificationReceipt | undefined> {
    const found = await this.projectRows<Row>(
      input.scope,
      `SELECT public_receipt FROM sla_rollout_verification_receipts
        WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND goal=$4 AND policy_enable_epoch_hash=$5`,
      [input.workItemId, input.goal, input.policyEnableEpochHash],
    );
    return found[0]
      ? json<SlaRolloutAuthorityVerificationReceipt>(found[0].public_receipt)
      : undefined;
  }

  async appendReceipt(
    input: Readonly<{
      scope: ProjectScope;
      receipt: SlaRolloutAuthorityVerificationReceipt;
    }>,
  ): Promise<
    Readonly<{
      outcome: "APPENDED" | "NO_OP_DUPLICATE";
      receipt: SlaRolloutAuthorityVerificationReceipt;
    }>
  > {
    const value = input.receipt;
    assertReceipt(value, input.scope);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const inserted = rows(
        await manager.query(
          `INSERT INTO sla_rollout_verification_receipts(
           receipt_id,workspace_id,project_id,work_item_id,goal,policy_enable_epoch_hash,policy_ref,calendar_ref,mapping_ref,
           operational_projection_ref,external_revision_token,authority_fields_hash,observed_normalized_status,
           provider_observed_at,verifier_run_ref,reducer_disposition,confirmed_at,public_receipt,semantic_hash
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DUPLICATE',$16,$17,$18)
         ON CONFLICT(workspace_id,project_id,work_item_id,goal,policy_enable_epoch_hash) DO NOTHING
         RETURNING public_receipt`,
          [
            value.receiptId,
            value.workspaceId,
            value.projectId,
            value.workItemId,
            value.goal,
            value.policyEnableEpochRef.semanticHash,
            JSON.stringify(value.policyFacetRef),
            JSON.stringify(value.calendarRef),
            JSON.stringify(value.mappingRef),
            JSON.stringify(value.operationalProjectionRef),
            value.externalRevisionToken,
            value.authorityFieldsHash,
            value.observedNormalizedStatus,
            value.providerObservedAt,
            JSON.stringify(value.verifierRunRef),
            value.confirmedAt,
            JSON.stringify(value),
            value.semanticHash,
          ],
        ),
      );
      if (inserted[0]) return Object.freeze({ outcome: "APPENDED" as const, receipt: value });
      const existing = rows(
        await manager.query(
          `SELECT public_receipt FROM sla_rollout_verification_receipts
          WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND goal=$4 AND policy_enable_epoch_hash=$5
          FOR SHARE`,
          [
            value.workspaceId,
            value.projectId,
            value.workItemId,
            value.goal,
            value.policyEnableEpochRef.semanticHash,
          ],
        ),
      );
      if (!existing[0]) throw new Error("SLA_ROLLOUT_RECEIPT_RACE_UNRESOLVED");
      const receipt = json<SlaRolloutAuthorityVerificationReceipt>(existing[0].public_receipt);
      assertReceipt(receipt, input.scope);
      if (receipt.semanticHash !== value.semanticHash)
        throw new Error("SLA_ROLLOUT_RECEIPT_EPOCH_CONFLICT");
      return Object.freeze({ outcome: "NO_OP_DUPLICATE" as const, receipt });
    });
  }
}
