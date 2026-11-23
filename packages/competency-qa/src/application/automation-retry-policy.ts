import { createHash } from "node:crypto";

import type {
  QaAutomationAttemptRecord,
  QaAutomationAttemptResult,
} from "../domain/automation-attempt.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaServiceActor,
} from "../domain/primitives.ts";

export type QaAutomationRetryDecisionKind = "NOT_APPLICABLE" | "DENIED" | "SCHEDULED";
export type QaAutomationRetryReasonCode =
  | "OUTCOME_INELIGIBLE"
  | "INFRA_CODE_MISSING"
  | "INFRA_CODE_NOT_ALLOWLISTED"
  | "RETRY_BUDGET_EXHAUSTED"
  | "AUTHORIZATION_DENIED"
  | "QUARANTINE_ACTIVE"
  | "POLICY_DENIED"
  | "CONFIGURATION_PIN_CHANGED"
  | "TARGET_CHANGED"
  | "SCHEDULED_ALLOWLISTED_INFRA";

export interface QaAutomationRetryPolicy {
  readonly policyRef: string;
  readonly policyHash: QaContentHash;
  readonly automaticRetryBudget: 1;
  readonly allowedInfrastructureCodes: readonly string[];
}

export interface QaAutomationRetryAuthority {
  readonly authorizationAllowed: boolean;
  readonly policyAllowed: boolean;
  readonly quarantineActive: boolean;
  readonly configurationPinsCurrent: boolean;
  readonly targetCurrent: boolean;
  readonly authorizationRecheckHash: QaContentHash;
}

export interface QaAutomationRetrySuccessorSpecification {
  readonly reason: "AUTO_INFRA_RETRY";
  readonly predecessorAttemptId: string;
  readonly rootAttemptId: string;
  readonly attemptNo: number;
  readonly automationAttemptId: string;
  readonly launchRequestId: string;
  readonly idempotencyKey: string;
  readonly effectIdempotencyKey: string;
  readonly effectKeyHash: QaContentHash;
  readonly causalHumanId: string;
  readonly causalAuthorizationBasisHash: QaContentHash;
}

export interface QaAutomationRetryDecision {
  readonly schemaVersion: "automation-retry-decision@1.0.0";
  readonly retryDecisionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly automationAttemptId: string;
  readonly automationAttemptResultId: string;
  readonly decision: QaAutomationRetryDecisionKind;
  readonly policyRef: string;
  readonly policyHash: QaContentHash;
  readonly automaticRetryBudget: 1;
  readonly infrastructureCode?: string;
  readonly reasonCode: QaAutomationRetryReasonCode;
  readonly automaticRetryOrdinal?: 1;
  readonly successorAttemptId?: string;
  readonly successorLaunchRequestId?: string;
  readonly authorizationRecheckHash: QaContentHash;
  readonly decidedByKind: "SERVICE";
  readonly decidedById: string;
  readonly decidedAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly contentHash: QaContentHash;
}

export interface QaAutomationRetryEvaluation {
  readonly decision: QaAutomationRetryDecision;
  readonly successor?: QaAutomationRetrySuccessorSpecification;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function validHash(value: string): value is QaContentHash {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function decisionKind(reasonCode: QaAutomationRetryReasonCode): QaAutomationRetryDecisionKind {
  if (reasonCode === "SCHEDULED_ALLOWLISTED_INFRA") return "SCHEDULED";
  return [
    "OUTCOME_INELIGIBLE",
    "INFRA_CODE_MISSING",
    "INFRA_CODE_NOT_ALLOWLISTED",
    "RETRY_BUDGET_EXHAUSTED",
  ].includes(reasonCode)
    ? "NOT_APPLICABLE"
    : "DENIED";
}

function settleReason(
  input: Readonly<{
    result: QaAutomationAttemptResult;
    policy: QaAutomationRetryPolicy;
    authority: QaAutomationRetryAuthority;
    automaticRetryCount: number;
  }>,
): QaAutomationRetryReasonCode {
  if (input.result.outcome !== "INFRA_FAILED") return "OUTCOME_INELIGIBLE";
  if (!input.result.infrastructureCode) return "INFRA_CODE_MISSING";
  if (!input.policy.allowedInfrastructureCodes.includes(input.result.infrastructureCode))
    return "INFRA_CODE_NOT_ALLOWLISTED";
  if (input.automaticRetryCount >= input.policy.automaticRetryBudget)
    return "RETRY_BUDGET_EXHAUSTED";
  if (!input.authority.authorizationAllowed) return "AUTHORIZATION_DENIED";
  if (input.authority.quarantineActive) return "QUARANTINE_ACTIVE";
  if (!input.authority.policyAllowed) return "POLICY_DENIED";
  if (!input.authority.configurationPinsCurrent) return "CONFIGURATION_PIN_CHANGED";
  if (!input.authority.targetCurrent) return "TARGET_CHANGED";
  return "SCHEDULED_ALLOWLISTED_INFRA";
}

export function decideQaAutomationRetry(
  input: Readonly<{
    attempt: QaAutomationAttemptRecord;
    result: QaAutomationAttemptResult;
    lineage: readonly QaAutomationAttemptRecord[];
    policy: QaAutomationRetryPolicy;
    authority: QaAutomationRetryAuthority;
    decidedBy: QaServiceActor;
    decidedAt: string;
    correlationId: string;
    causationId: string;
  }>,
): QaAutomationRetryEvaluation {
  const lineage = [...input.lineage].sort((left, right) => left.attemptNo - right.attemptNo);
  if (
    input.attempt.currentStatus !== "TERMINAL" ||
    input.attempt.terminalResultId !== input.result.automationAttemptResultId ||
    input.result.automationAttemptId !== input.attempt.automationAttemptId ||
    input.result.workspaceId !== input.attempt.workspaceId ||
    input.result.projectId !== input.attempt.projectId ||
    input.decidedBy.kind !== "SERVICE" ||
    !input.decidedBy.principalId ||
    !input.decidedBy.serviceKey ||
    !input.policy.policyRef ||
    input.policy.automaticRetryBudget !== 1 ||
    !validHash(input.policy.policyHash) ||
    !validHash(input.authority.authorizationRecheckHash) ||
    Number.isNaN(Date.parse(input.decidedAt)) ||
    lineage.length === 0 ||
    lineage.at(-1)?.automationAttemptId !== input.attempt.automationAttemptId ||
    lineage.some(
      (attempt, index) =>
        attempt.attemptNo !== index + 1 || attempt.rootAttemptId !== input.attempt.rootAttemptId,
    )
  )
    throw new QaDomainError("QA_AUTOMATION_RETRY_INPUT_INVALID");
  const allowlist = [...new Set(input.policy.allowedInfrastructureCodes)].sort();
  if (allowlist.some((code) => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)))
    throw new QaDomainError("QA_AUTOMATION_RETRY_POLICY_INVALID");
  const automaticRetryCount = lineage.filter(({ reason }) => reason === "AUTO_INFRA_RETRY").length;
  const reasonCode = settleReason({
    ...input,
    policy: { ...input.policy, allowedInfrastructureCodes: allowlist },
    automaticRetryCount,
  });
  const decision = decisionKind(reasonCode);
  const identity = `${input.attempt.workspaceId}:${input.attempt.projectId}:${input.attempt.automationAttemptId}:${input.result.contentHash}:${input.policy.policyHash}`;
  const retryDecisionId = deterministicUuid(`qa-automation-retry-decision:${identity}`);
  let successor: QaAutomationRetrySuccessorSpecification | undefined;
  if (decision === "SCHEDULED") {
    const effectIdempotencyKey = `qa:automation:auto-retry:${qaAggregateSnapshotHash({ predecessorAttemptId: input.attempt.automationAttemptId, policyHash: input.policy.policyHash } as never).slice("sha256:".length)}`;
    successor = Object.freeze({
      reason: "AUTO_INFRA_RETRY",
      predecessorAttemptId: input.attempt.automationAttemptId,
      rootAttemptId: input.attempt.rootAttemptId,
      attemptNo: input.attempt.attemptNo + 1,
      automationAttemptId: deterministicUuid(`qa-automation-auto-retry-attempt:${identity}`),
      launchRequestId: deterministicUuid(`qa-automation-auto-retry-launch:${identity}`),
      idempotencyKey: `auto-retry:${input.attempt.automationAttemptId}:${input.policy.policyHash}`,
      effectIdempotencyKey,
      effectKeyHash: qaAggregateSnapshotHash(effectIdempotencyKey as never),
      causalHumanId: input.attempt.initiatingHumanId,
      causalAuthorizationBasisHash: input.attempt.authorizationBasisHash,
    });
  }
  const body = Object.freeze({
    schemaVersion: "automation-retry-decision@1.0.0" as const,
    retryDecisionId,
    workspaceId: input.attempt.workspaceId,
    projectId: input.attempt.projectId,
    automationAttemptId: input.attempt.automationAttemptId,
    automationAttemptResultId: input.result.automationAttemptResultId,
    decision,
    policyRef: input.policy.policyRef,
    policyHash: input.policy.policyHash,
    automaticRetryBudget: 1 as const,
    ...(input.result.infrastructureCode
      ? { infrastructureCode: input.result.infrastructureCode }
      : {}),
    reasonCode,
    ...(successor
      ? {
          automaticRetryOrdinal: 1 as const,
          successorAttemptId: successor.automationAttemptId,
          successorLaunchRequestId: successor.launchRequestId,
        }
      : {}),
    authorizationRecheckHash: input.authority.authorizationRecheckHash,
    decidedByKind: "SERVICE" as const,
    decidedById: input.decidedBy.principalId,
    decidedAt: input.decidedAt,
    correlationId: input.correlationId,
    causationId: input.causationId,
  });
  return Object.freeze({
    decision: Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) }),
    ...(successor ? { successor } : {}),
  });
}

export function qaAutomationFlakySuspected(
  results: readonly Readonly<{
    attemptNo: number;
    outcome: QaAutomationAttemptResult["outcome"];
  }>[],
): boolean {
  const ordered = [...results].sort((left, right) => left.attemptNo - right.attemptNo);
  return ordered.some(
    (result, index) =>
      result.outcome === "PASS" &&
      ordered.slice(0, index).some(({ outcome }) => outcome === "ASSERTION_FAILED"),
  );
}
