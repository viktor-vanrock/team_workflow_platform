import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  createQaVerdict,
  qaAggregateSnapshotHash,
  type QaContentHash,
  type QaExactReference,
  type QaRequestExtension,
  type QaVerdictAggregate,
  type QaVerdictInput,
  type QaVerdictSignature,
  signQaVerdict,
  TypeOrmQaVerdictDodRepository,
} from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";

import type { QaCompletionAuthority } from "./completion-runtime.ts";
import { loadQaAdjudicationInventory } from "./dod-inventory.ts";
import type { QaDodPolicyPort } from "./dod-runtime.ts";
import { currentQaCommandAuthority } from "./qa-command-authority.ts";
import { invalidateQaCompletionForVerdict } from "./verdict-completion-invalidation.ts";
import {
  DurableQaVerdictCosignRuntime,
  type QaVerdictCosignDecisionResult,
  type QaVerdictCosignRequestResult,
} from "./verdict-cosign-runtime.ts";
import { persistQaVerdictSignatureEvents } from "./verdict-signature-events.ts";

export interface QaVerdictDraftRequest {
  readonly verdict: QaVerdictInput["verdict"];
  readonly residualRisk: QaVerdictInput["residualRisk"];
  readonly expectedAggregateSnapshotHash?: QaContentHash;
  readonly supersedesVerdictRef?: QaExactReference;
  readonly revisionReason?: string;
}
export interface QaVerdictRuntime {
  create(
    authority: QaCompletionAuthority,
    workItemId: string,
    request: QaVerdictDraftRequest,
    supersession?: Readonly<{ verdictId: string; expectedVersion: number }>,
  ): Promise<QaVerdictAggregate>;
  sign(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    expectedVersion: number,
  ): Promise<Readonly<{ verdict: Record<string, unknown>; signature: QaVerdictSignature }>>;
  requestCosign(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<QaVerdictCosignRequestResult>;
  approveCosign(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    approvalId: string,
  ): Promise<QaVerdictCosignDecisionResult>;
}
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => {
  const array = value as unknown[];
  return (Array.isArray(array[0]) ? array[0] : array) as Row[];
};
const same = (a: unknown, b: unknown) =>
  qaAggregateSnapshotHash(a as never) === qaAggregateSnapshotHash(b as never);
const stale = () => new Error("QA_VERDICT_CURRENT_INPUTS_REQUIRED");
const date = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();

/** Human judgment is explicit; risk, version and the exact evidence inventory are server-owned. */
export class DurableQaVerdictRuntime implements QaVerdictRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly policies: QaDodPolicyPort,
  ) {}
  requestCosign(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    expectedVersion: number,
    reason: string,
  ) {
    return new DurableQaVerdictCosignRuntime(this.source, this).request(
      authority,
      workItemId,
      verdictId,
      expectedVersion,
      reason,
    );
  }
  approveCosign(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    approvalId: string,
  ) {
    return new DurableQaVerdictCosignRuntime(this.source, this).approve(
      authority,
      workItemId,
      verdictId,
      approvalId,
    );
  }
  async create(
    authority: QaCompletionAuthority,
    workItemId: string,
    request: QaVerdictDraftRequest,
    supersession?: Readonly<{ verdictId: string; expectedVersion: number }>,
  ) {
    await authority.authorize("qa.verdict.sign");
    this.assertJudgment(request);
    return this.source.transaction("READ COMMITTED", async (manager) => {
      const snapshot = await this.snapshot(manager, authority, workItemId);
      if (
        request.expectedAggregateSnapshotHash !== undefined &&
        request.expectedAggregateSnapshotHash !== snapshot.row.adjudicative_aggregate_hash
      )
        throw stale();
      const predecessorRef = request.supersedesVerdictRef;
      const predecessor = predecessorRef
        ? await this.row(manager, authority, workItemId, predecessorRef.id)
        : undefined;
      if (
        supersession &&
        (!Number.isSafeInteger(supersession.expectedVersion) ||
          !predecessor ||
          predecessorRef?.id !== supersession.verdictId ||
          Number(predecessor.resource_version) !== supersession.expectedVersion)
      )
        throw stale();
      if (
        predecessor &&
        (predecessor.state !== "SIGNED" ||
          Number(predecessor.version) !== predecessorRef!.version ||
          predecessor.content_hash !== predecessorRef!.contentHash ||
          !request.revisionReason?.trim())
      )
        throw stale();
      const verdict = this.build(snapshot, {
        verdictId: randomUUID(),
        version: predecessor ? Number(predecessor.version) + 1 : 1,
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        workItemId,
        createdBy: snapshot.authorization.actor,
        createdAt: new Date().toISOString(),
        verdict: request.verdict,
        residualRisk: request.residualRisk,
        ...(predecessorRef
          ? { supersedesVerdictRef: predecessorRef, revisionReason: request.revisionReason }
          : {}),
      });
      const fresh = await this.recheck(manager, authority, snapshot);
      await new TypeOrmQaVerdictDodRepository(manager).insertVerdict(verdict);
      if (predecessor) {
        const [changed] = rows(
          await manager.query(
            "UPDATE qa_verdicts SET state='SUPERSEDED',superseded_by_verdict_id=$1,supersession_reason=$2,superseded_at=$3,resource_version=resource_version+1 WHERE workspace_id=$4 AND project_id=$5 AND work_item_id=$6 AND verdict_id=$7 AND resource_version=$8 AND state='SIGNED' RETURNING verdict_id",
            [
              verdict.verdictId,
              request.revisionReason,
              verdict.createdAt,
              authority.workspaceId,
              authority.projectId,
              workItemId,
              predecessor.verdict_id,
              predecessor.resource_version,
            ],
          ),
        );
        if (!changed) throw stale();
        await invalidateQaCompletionForVerdict(manager, verdict, fresh);
      }
      return verdict;
    });
  }
  async sign(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    expectedVersion: number,
  ) {
    await authority.authorize("qa.verdict.sign");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw stale();
    return this.source.transaction("READ COMMITTED", async (manager) => {
      const snapshot = await this.snapshot(manager, authority, workItemId);
      const row = await this.row(manager, authority, workItemId, verdictId);
      if (row.state !== "DRAFT" || Number(row.resource_version) !== expectedVersion)
        throw new Error("QA_VERDICT_CAS_CONFLICT");
      const predecessor = row.supersedes_verdict_id
        ? await this.row(manager, authority, workItemId, String(row.supersedes_verdict_id))
        : undefined;
      const verdict = this.build(snapshot, {
        verdictId,
        version: Number(row.version),
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        workItemId,
        createdBy: row.created_by as QaVerdictInput["createdBy"],
        createdAt: date(row.created_at),
        verdict: row.verdict as QaVerdictInput["verdict"],
        residualRisk: row.residual_risk as QaVerdictInput["residualRisk"],
        ...(predecessor
          ? {
              supersedesVerdictRef: {
                id: String(predecessor.verdict_id),
                version: Number(predecessor.version),
                contentHash: predecessor.content_hash as QaContentHash,
              },
              revisionReason: String(row.revision_reason),
            }
          : {}),
      });
      if (verdict.contentHash !== row.content_hash) throw stale();
      const fresh = await this.recheck(manager, authority, snapshot);
      const role = await currentQaCommandAuthority(
        this.source,
        authority,
        fresh.actor,
        String(snapshot.row.classification_key),
      ).authorize("qa.verdict.sign");
      if (!["qa-executor", "QA_EXECUTOR"].includes(role.roleKey))
        throw new Error("QA_VERDICT_PRIMARY_NOT_AUTHORIZED");
      const signature = signQaVerdict(verdict, {
        actor: fresh.actor,
        role: "QA_EXECUTOR",
        permission: "qa.verdict.sign",
        liveAuthorized: true,
        authorizationBasisHash: qaAggregateSnapshotHash(fresh.basis as never),
        at: new Date().toISOString(),
      });
      await new TypeOrmQaVerdictDodRepository(manager).appendSignature(
        authority,
        workItemId,
        verdictId,
        signature,
      );
      const [changed] = rows(
        await manager.query(
          "UPDATE qa_verdicts SET state=$1,signed_at=$2,resource_version=resource_version+1 WHERE workspace_id=$3 AND project_id=$4 AND work_item_id=$5 AND verdict_id=$6 AND resource_version=$7 AND state='DRAFT' RETURNING *",
          [
            verdict.state,
            verdict.signedAt ?? null,
            authority.workspaceId,
            authority.projectId,
            workItemId,
            verdictId,
            expectedVersion,
          ],
        ),
      );
      if (!changed) throw stale();
      await persistQaVerdictSignatureEvents(
        manager,
        verdict,
        fresh,
        String(snapshot.row.classification_key),
        randomUUID(),
      );
      return { verdict: changed, signature };
    });
  }
  async currentForCosign(
    manager: EntityManager,
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
  ) {
    if (!manager.queryRunner?.isTransactionActive) throw stale();
    const snapshot = await this.snapshot(manager, authority, workItemId);
    const row = await this.row(manager, authority, workItemId, verdictId);
    const predecessor = row.supersedes_verdict_id
      ? await this.row(manager, authority, workItemId, String(row.supersedes_verdict_id))
      : undefined;
    const verdict = this.build(snapshot, {
      verdictId,
      version: Number(row.version),
      workspaceId: authority.workspaceId,
      projectId: authority.projectId,
      workItemId,
      createdBy: row.created_by as QaVerdictInput["createdBy"],
      createdAt: date(row.created_at),
      verdict: row.verdict as QaVerdictInput["verdict"],
      residualRisk: row.residual_risk as QaVerdictInput["residualRisk"],
      ...(predecessor
        ? {
            supersedesVerdictRef: {
              id: String(predecessor.verdict_id),
              version: Number(predecessor.version),
              contentHash: predecessor.content_hash as QaContentHash,
            },
            revisionReason: String(row.revision_reason),
          }
        : {}),
    });
    if (
      row.state !== "PARTIALLY_SIGNED" ||
      verdict.contentHash !== row.content_hash ||
      verdict.effectiveRisk === "ORDINARY"
    )
      throw stale();
    const signatures = rows(
      await manager.query(
        "SELECT * FROM qa_verdict_signatures WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND verdict_id=$4",
        [authority.workspaceId, authority.projectId, workItemId, verdictId],
      ),
    );
    if (signatures.length !== 1 || signatures[0]!.role !== "PRIMARY") throw stale();
    const signature = signatures[0]!;
    verdict.addSignature({
      signatureId: String(signature.signature_id),
      role: "PRIMARY",
      verdictContentHash: signature.verdict_content_hash as QaContentHash,
      signer: signature.signer as QaVerdictSignature["signer"],
      authorizationBasisHash: signature.authorization_basis_hash as QaContentHash,
      signedAt: date(signature.signed_at),
    });
    const [input] = rows(
      await manager.query(
        "SELECT operational_binding_id,operational_binding_version FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND input_revision_id=$4",
        [
          authority.workspaceId,
          authority.projectId,
          workItemId,
          snapshot.row.current_input_revision_id,
        ],
      ),
    );
    if (!input) throw stale();
    await this.recheck(manager, authority, snapshot);
    return {
      verdict,
      resourceVersion: Number(row.resource_version),
      classificationKey: String(snapshot.row.classification_key),
      bindingRef: {
        id: String(input.operational_binding_id),
        version: Number(input.operational_binding_version),
      },
    };
  }
  private assertJudgment(request: QaVerdictDraftRequest) {
    if (
      !["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"].includes(request.verdict) ||
      !request.residualRisk ||
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(request.residualRisk.classification) ||
      typeof request.residualRisk.statement !== "string" ||
      !request.residualRisk.statement.trim() ||
      request.residualRisk.statement.length > 10_000 ||
      (request.revisionReason !== undefined &&
        (typeof request.revisionReason !== "string" ||
          !request.revisionReason.trim() ||
          request.revisionReason.length > 2000))
    )
      throw new Error("QA_VERDICT_INPUT_INVALID");
  }
  private async snapshot(
    manager: EntityManager,
    authority: QaCompletionAuthority,
    workItemId: string,
  ) {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `qa-request:${authority.workspaceId}:${authority.projectId}:${workItemId}`,
    ]);
    const [row] = rows(
      await manager.query(
        "SELECT e.*,w.classification_key,w.normalized_status FROM qa_request_extensions e JOIN work_items w ON w.workspace_id=e.workspace_id AND w.project_id=e.project_id AND w.id=e.work_item_id WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.work_item_id=$3 FOR UPDATE OF e,w",
        [authority.workspaceId, authority.projectId, workItemId],
      ),
    );
    if (
      !row ||
      row.completion_in_flight_candidate_id ||
      ["DONE", "CANCELLED"].includes(String(row.normalized_status)) ||
      (row.completion_dispatch_guard as { state?: string } | null)?.state === "DONE_FROZEN"
    )
      throw stale();
    const authorization = await authority.authorize("qa.verdict.sign");
    this.classification(authorization.classificationCeiling, String(row.classification_key));
    const policy = await this.policies.load(manager, authority, row.content as QaRequestExtension);
    this.classification(policy.maximumClassificationKey, String(row.classification_key));
    const ceiling = [authorization.classificationCeiling, policy.maximumClassificationKey]
      .map((key) => defaultClassificationCatalog.reference(key))
      .sort((a, b) => a.rank - b.rank)[0]!.key;
    const inventory = await loadQaAdjudicationInventory(
      manager,
      authority,
      workItemId,
      row,
      policy,
      ceiling,
    );
    if (
      !inventory.evidencePolicySatisfied ||
      !inventory.sessionReviews.length ||
      inventory.sessionReviews.some((review) => !review.current || !review.evidenceComplete)
    )
      throw new Error("QA_VERDICT_INVENTORY_INCOMPLETE");
    return { row, authorization, policy, inventory };
  }
  private build(
    snapshot: Awaited<ReturnType<DurableQaVerdictRuntime["snapshot"]>>,
    input: Pick<
      QaVerdictInput,
      | "verdictId"
      | "version"
      | "workspaceId"
      | "projectId"
      | "workItemId"
      | "createdBy"
      | "createdAt"
    > &
      QaVerdictDraftRequest,
  ) {
    this.assertJudgment(input);
    const { inventory, policy, row } = snapshot;
    const risk =
      inventory.minimumEffectiveRisk === "CRITICAL" ||
      input.residualRisk.classification === "CRITICAL"
        ? "CRITICAL"
        : inventory.minimumEffectiveRisk === "HIGH" || input.residualRisk.classification === "HIGH"
          ? "HIGH"
          : "ORDINARY";
    const exact = ({ id, version, contentHash }: QaExactReference) => ({
      id,
      version,
      contentHash,
    });
    return createQaVerdict({
      verdictId: input.verdictId,
      version: input.version,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      verdict: input.verdict,
      residualRisk: {
        classification: input.residualRisk.classification,
        statement: input.residualRisk.statement,
      },
      effectiveRisk: risk,
      requiredSessionPlanRef: exact(inventory.requiredSessionPlan),
      sessionReviewRefs: inventory.sessionReviews.filter((review) => review.current).map(exact),
      evidenceManifestRefs: inventory.sessionReviews.flatMap((review) =>
        review.evidenceManifestRef ? [exact(review.evidenceManifestRef)] : [],
      ),
      findingOutcomeRefs: inventory.findingOutcomeRefs.map(exact),
      dodRuleSetRef: policy.rules,
      riskPolicyRef: policy.riskPolicyRef,
      aggregateSnapshotHash: row.adjudicative_aggregate_hash as QaContentHash,
      ...(input.supersedesVerdictRef
        ? {
            supersedesVerdictRef: exact(input.supersedesVerdictRef),
            revisionReason: input.revisionReason,
          }
        : {}),
    });
  }
  private async recheck(
    manager: EntityManager,
    authority: QaCompletionAuthority,
    snapshot: Awaited<ReturnType<DurableQaVerdictRuntime["snapshot"]>>,
  ) {
    const fresh = await authority.authorize("qa.verdict.sign");
    if (
      fresh.actor.kind !== "HUMAN" ||
      !same(fresh.actor, snapshot.authorization.actor) ||
      fresh.classificationCeiling !== snapshot.authorization.classificationCeiling ||
      !same(
        snapshot.policy,
        await this.policies.load(manager, authority, snapshot.row.content as QaRequestExtension),
      )
    )
      throw stale();
    this.classification(fresh.classificationCeiling, String(snapshot.row.classification_key));
    return fresh;
  }
  private classification(ceiling: string, key: string) {
    if (
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(ceiling),
        defaultClassificationCatalog.reference(key),
      )
    )
      throw new Error("QA_VERDICT_CLASSIFICATION_DENIED");
  }
  private async row(
    manager: EntityManager,
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
  ) {
    const [row] = rows(
      await manager.query(
        "SELECT * FROM qa_verdicts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND verdict_id=$4 FOR UPDATE",
        [authority.workspaceId, authority.projectId, workItemId, verdictId],
      ),
    );
    if (!row) throw new Error("QA_VERDICT_NOT_FOUND");
    return row;
  }
}
