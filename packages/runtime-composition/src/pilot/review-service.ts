import type { PilotMetricAggregate } from "@awp/competency-qa";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { PilotGuardrailEvaluation } from "./guardrail-service.ts";

export type PilotRecommendation = "CONTINUE" | "ADJUST" | "STOP" | "INSUFFICIENT_DATA";
export interface PilotReport {
  readonly reportId: string;
  readonly cohortHash: Sha256Digest;
  readonly deploymentHash: Sha256Digest;
  readonly protocolHash: Sha256Digest;
  readonly baselineHash: Sha256Digest;
  readonly observedSampleSize: number;
  readonly minimumSample: number;
  readonly measurementComplete: boolean;
  readonly metrics: readonly PilotMetricAggregate[];
  readonly guardrails: PilotGuardrailEvaluation;
  readonly independentlyObservedExternalWrites: number | null;
  readonly incidents: readonly string[];
  readonly operatorLoadMinutes: number | null;
  readonly limitations: readonly string[];
  readonly residualRisks: readonly string[];
  readonly recommendation: PilotRecommendation;
  readonly createdAt: string;
  readonly contentHash: Sha256Digest;
}

export interface PilotReviewDecision {
  readonly reviewId: string;
  readonly reportHash: Sha256Digest;
  readonly decision: PilotRecommendation;
  readonly qaLead: Readonly<{ kind: "HUMAN"; principalId: string; authorizationRef: string }>;
  readonly sponsor: Readonly<{ kind: "HUMAN"; principalId: string; authorizationRef: string }>;
  readonly reason: string;
  readonly decidedAt: string;
  readonly contentHash: Sha256Digest;
}

export function createPilotReport(
  input: Omit<PilotReport, "measurementComplete" | "recommendation" | "contentHash"> &
    Readonly<{ requestedRecommendation: Exclude<PilotRecommendation, "INSUFFICIENT_DATA"> }>,
): PilotReport {
  if (
    !input.reportId ||
    input.observedSampleSize < 0 ||
    input.minimumSample < 1 ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    (input.operatorLoadMinutes !== null && input.operatorLoadMinutes < 0)
  )
    throw new Error("PILOT_REPORT_INVALID");
  const measurementComplete =
    input.observedSampleSize >= input.minimumSample &&
    input.metrics.length > 0 &&
    input.metrics.every((metric) => metric.value !== null && metric.missingCount === 0) &&
    input.guardrails.state !== "UNKNOWN" &&
    input.independentlyObservedExternalWrites !== null &&
    input.operatorLoadMinutes !== null;
  const recommendation: PilotRecommendation = !measurementComplete
    ? "INSUFFICIENT_DATA"
    : input.guardrails.state === "BREACH"
      ? "STOP"
      : input.requestedRecommendation;
  const semantic = {
    reportId: input.reportId,
    cohortHash: input.cohortHash,
    deploymentHash: input.deploymentHash,
    protocolHash: input.protocolHash,
    baselineHash: input.baselineHash,
    observedSampleSize: input.observedSampleSize,
    minimumSample: input.minimumSample,
    metrics: input.metrics,
    guardrails: input.guardrails,
    independentlyObservedExternalWrites: input.independentlyObservedExternalWrites,
    incidents: input.incidents,
    operatorLoadMinutes: input.operatorLoadMinutes,
    limitations: input.limitations,
    residualRisks: input.residualRisks,
    createdAt: input.createdAt,
  };
  const body = Object.freeze({ ...structuredClone(semantic), measurementComplete, recommendation });
  return Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
}

export function createPilotReviewDecision(
  input: Omit<PilotReviewDecision, "contentHash">,
  report: PilotReport,
): PilotReviewDecision {
  if (
    !input.reviewId ||
    input.reportHash !== report.contentHash ||
    input.decision !== report.recommendation ||
    !input.reason.trim() ||
    input.qaLead.kind !== "HUMAN" ||
    input.sponsor.kind !== "HUMAN" ||
    input.qaLead.principalId === input.sponsor.principalId ||
    !input.qaLead.authorizationRef ||
    !input.sponsor.authorizationRef ||
    Number.isNaN(Date.parse(input.decidedAt)) ||
    Date.parse(input.decidedAt) < Date.parse(report.createdAt)
  )
    throw new Error("PILOT_REVIEW_DECISION_INVALID");
  const body = structuredClone(input);
  return Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
}
