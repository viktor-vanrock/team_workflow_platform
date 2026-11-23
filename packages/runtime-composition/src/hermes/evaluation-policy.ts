import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  assertProjectScope,
  type ExactRevisionRef,
  freezePilotValue,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";
import {
  type RuntimeConfigurationPublication,
  RuntimeConfigurationRepository,
} from "@awp/platform-persistence-typeorm";

import {
  type HermesEvaluationCandidate,
  type HermesEvaluationRun,
  sameHermesEvaluationCandidate,
} from "./evaluation.ts";

export interface HermesEvaluationApproval {
  readonly scope: ProjectScope;
  readonly evaluationRef: ExactRevisionRef;
  readonly reviewRef: ExactRevisionRef;
  readonly evaluation: HermesEvaluationRun;
  readonly reviewerKind: "HUMAN";
  readonly reviewerId: string;
  readonly outcome: "APPROVED";
  readonly validUntil: string;
  readonly mode: "DEVELOPMENT_MOCKS" | "CORPORATE";
  readonly compatibilityRef: ExactRevisionRef;
}
/** Adapter must enforce current HUMAN policy-publish rights and load an immutable report with its exact reviewed revision. */
export interface HermesEvaluationPolicyAuthority {
  authorize(scope: ProjectScope, actorId: string, manager?: EntityManager): Promise<boolean>;
  loadApproved(
    scope: ProjectScope,
    evaluationRef: ExactRevisionRef,
    reviewRef: ExactRevisionRef,
    manager: EntityManager,
  ): Promise<HermesEvaluationApproval>;
}
export interface HermesPendingProposalInvalidator {
  invalidate(
    manager: EntityManager,
    scope: ProjectScope,
    selectedAt: Date,
  ): Promise<Readonly<Record<string, number>>>;
}
export interface HermesPolicySelectionInput extends ProjectScope {
  readonly actorId: string;
  readonly expectedRowVersion: number;
  readonly candidate: HermesEvaluationCandidate;
  readonly evaluationRef: ExactRevisionRef;
  readonly reviewRef: ExactRevisionRef;
  readonly compatibilityRef: ExactRevisionRef;
  readonly validUntil: string;
  readonly requestKey: string;
  readonly rollbackTargetRef?: ExactRevisionRef;
}
export interface HermesSelectedPolicy extends ProjectScope {
  readonly schemaVersion: "hermes-evaluation-policy@1.0.0";
  readonly mode: "DEVELOPMENT_MOCKS" | "CORPORATE";
  readonly candidate: HermesEvaluationCandidate;
  readonly evaluationRef: ExactRevisionRef;
  readonly reviewRef: ExactRevisionRef;
  readonly compatibilityRef: ExactRevisionRef;
  readonly selectedAt: string;
  readonly requestKey: string;
  readonly requestHash: string;
  readonly invalidatedProposals: Readonly<Record<string, number>>;
  readonly rollbackTargetRef?: ExactRevisionRef;
}
const hash = (value: unknown) => sha256(value as JsonValue);
export const hermesPolicyId = (scope: ProjectScope) => `hermes:${scope.projectId}`;
function approved(
  value: HermesEvaluationApproval,
  input: HermesPolicySelectionInput,
  mode: HermesSelectedPolicy["mode"],
  now: Date,
): void {
  const { contentHash, ...body } = value.evaluation;
  if (
    value.scope.workspaceId !== input.workspaceId ||
    value.scope.projectId !== input.projectId ||
    value.mode !== mode ||
    value.outcome !== "APPROVED" ||
    value.reviewerKind !== "HUMAN" ||
    !value.reviewerId ||
    !samePilotRef(value.evaluationRef, input.evaluationRef) ||
    !samePilotRef(value.reviewRef, input.reviewRef) ||
    !samePilotRef(value.compatibilityRef, input.compatibilityRef) ||
    input.evaluationRef.id !== value.evaluation.runId ||
    input.evaluationRef.contentHash !== contentHash ||
    hash(body) !== contentHash ||
    !sameHermesEvaluationCandidate(value.evaluation.candidate, input.candidate) ||
    value.evaluation.status !== "PASS" ||
    value.evaluation.passRate !== 1 ||
    value.evaluation.unauthorizedOperations !== 0 ||
    value.evaluation.leakageCount !== 0 ||
    value.evaluation.results.length < 3 ||
    value.evaluation.results.length !== value.evaluation.caseIds.length ||
    new Set(value.evaluation.caseIds).size !== value.evaluation.caseIds.length ||
    value.evaluation.results.some(
      (result, index) =>
        result.caseId !== value.evaluation.caseIds[index] ||
        result.status !== "PASS" ||
        result.unauthorizedOperations !== 0 ||
        result.leakageCount !== 0,
    ) ||
    !Number.isFinite(Date.parse(value.validUntil)) ||
    Date.parse(value.validUntil) <= now.getTime() ||
    Date.parse(input.validUntil) > Date.parse(value.validUntil) ||
    !Number.isFinite(Date.parse(value.evaluation.finishedAt)) ||
    Date.parse(value.evaluation.finishedAt) > now.getTime()
  )
    throw new Error("HERMES_APPROVED_EVALUATION_REQUIRED");
}
/** Append-only MODEL_POLICY revisions, CAS selection and proposal invalidation share one transaction. */
export class HermesEvaluationPolicyService {
  private readonly configurations = new RuntimeConfigurationRepository();
  constructor(
    private readonly database: DataSource,
    private readonly authority: HermesEvaluationPolicyAuthority,
    private readonly proposals: HermesPendingProposalInvalidator,
    private readonly mode: HermesSelectedPolicy["mode"],
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async select(supplied: HermesPolicySelectionInput): Promise<RuntimeConfigurationPublication> {
    const input = freezePilotValue(structuredClone(supplied));
    assertProjectScope(input);
    [
      input.evaluationRef,
      input.reviewRef,
      input.compatibilityRef,
      input.candidate.configurationRef,
      input.candidate.modelRef,
      input.candidate.promptRef,
      input.candidate.skillRef,
      input.candidate.corpusRef,
    ].forEach(assertExactRevisionRef);
    if (input.rollbackTargetRef) assertExactRevisionRef(input.rollbackTargetRef);
    if (
      !Number.isSafeInteger(input.expectedRowVersion) ||
      input.expectedRowVersion < 0 ||
      !/^[a-zA-Z0-9_.:-]{1,128}$/u.test(input.requestKey) ||
      !Number.isFinite(Date.parse(input.validUntil)) ||
      Date.parse(input.validUntil) <= this.clock().getTime()
    )
      throw new Error("HERMES_SELECTION_INVALID");
    await this.authorize(input);
    return this.database.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SET LOCAL statement_timeout='5s'");
      await manager.query("SET LOCAL lock_timeout='5s'");
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `runtime-config:${input.workspaceId}:${hermesPolicyId(input)}`,
      ]);
      await manager.query(
        "SELECT configuration_id FROM runtime_configuration_headers WHERE workspace_id=$1 AND configuration_id=$2 FOR UPDATE",
        [input.workspaceId, hermesPolicyId(input)],
      );
      await this.authorize(input, manager);
      const proof = await this.authority.loadApproved(
        input,
        input.evaluationRef,
        input.reviewRef,
        manager,
      );
      approved(proof, input, this.mode, this.clock());
      const requestHash = hash(input);
      const prior = (await manager.query(
        "SELECT semantic_body FROM runtime_configuration_revisions WHERE workspace_id=$1 AND configuration_id=$2 AND semantic_body->'document'->>'requestKey'=$3",
        [input.workspaceId, hermesPolicyId(input), input.requestKey],
      )) as Array<{ semantic_body: RuntimeConfigurationPublication }>;
      if (prior.length) {
        if (prior.length !== 1 || prior[0]!.semantic_body.document.requestHash !== requestHash)
          throw new Error("HERMES_SELECTION_REPLAY_CONFLICT");
        return freezePilotValue(prior[0]!.semantic_body);
      }
      if (input.rollbackTargetRef) await this.rollbackTarget(manager, input);
      const now = this.clock();
      const invalidatedProposals = await this.proposals.invalidate(manager, input, now);
      const document: HermesSelectedPolicy = {
        schemaVersion: "hermes-evaluation-policy@1.0.0",
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        mode: this.mode,
        candidate: input.candidate,
        evaluationRef: input.evaluationRef,
        reviewRef: input.reviewRef,
        compatibilityRef: input.compatibilityRef,
        selectedAt: now.toISOString(),
        requestKey: input.requestKey,
        requestHash,
        invalidatedProposals,
        ...(input.rollbackTargetRef ? { rollbackTargetRef: input.rollbackTargetRef } : {}),
      };
      const value: RuntimeConfigurationPublication = {
        schemaVersion: 1,
        kind: "MODEL_POLICY",
        workspaceId: input.workspaceId,
        projectIds: [input.projectId],
        ref: {
          id: hermesPolicyId(input),
          version: input.expectedRowVersion + 1,
          contentHash: hash(document),
        },
        document: document as unknown as Record<string, JsonValue>,
        publishedBy: input.actorId,
        publishedAt: now.toISOString(),
        validUntil: input.validUntil,
        correlationId: randomUUID(),
      };
      await this.authorize(input, manager);
      const finalProof = await this.authority.loadApproved(
        input,
        input.evaluationRef,
        input.reviewRef,
        manager,
      );
      approved(finalProof, input, this.mode, this.clock());
      if (hash(finalProof) !== hash(proof)) throw new Error("HERMES_EVALUATION_REVIEW_CHANGED");
      await this.configurations.publish(manager, value, input.expectedRowVersion);
      return freezePilotValue(value);
    });
  }
  private async rollbackTarget(manager: EntityManager, input: HermesPolicySelectionInput) {
    const target = input.rollbackTargetRef!;
    if (target.id !== hermesPolicyId(input) || target.version > input.expectedRowVersion)
      throw new Error("HERMES_ROLLBACK_INCOMPATIBLE");
    const rows = (await manager.query(
      "SELECT semantic_body FROM runtime_configuration_revisions WHERE workspace_id=$1 AND configuration_id=$2 AND version=$3 AND content_hash=$4 AND kind='MODEL_POLICY'",
      [input.workspaceId, target.id, target.version, target.contentHash],
    )) as Array<{ semantic_body: RuntimeConfigurationPublication }>;
    const publication = rows[0]?.semantic_body,
      value = publication?.document as unknown as HermesSelectedPolicy | undefined;
    if (
      !publication ||
      !value ||
      hash(value) !== target.contentHash ||
      value.schemaVersion !== "hermes-evaluation-policy@1.0.0" ||
      value.workspaceId !== input.workspaceId ||
      value.projectId !== input.projectId ||
      value.mode !== this.mode ||
      !samePilotRef(value.compatibilityRef, input.compatibilityRef) ||
      !sameHermesEvaluationCandidate(value.candidate, input.candidate)
    )
      throw new Error("HERMES_ROLLBACK_INCOMPATIBLE");
  }
  private async authorize(input: HermesPolicySelectionInput, manager?: EntityManager) {
    if (!(await this.authority.authorize(input, input.actorId, manager)))
      throw new Error("HERMES_POLICY_ACCESS_DENIED");
  }
}
