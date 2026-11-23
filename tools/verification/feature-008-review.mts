import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FEATURE_008,
  record,
  ROOT_008,
  safeFile,
  write008Json,
} from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  evidenceRef008,
  type GateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

const guardrails = new Set([
  "CROSS_SCOPE_DISCLOSURES",
  "UNAUTHORIZED_EXTERNAL_WRITES",
  "DUPLICATE_EXTERNAL_EFFECTS",
  "AUDITED_CORRELATED_WRITE_COVERAGE",
  "VERDICT_EVIDENCE_CHAIN_COVERAGE",
  "AGENT_WITHOUT_HUMAN_ACTIONS",
  "SECRET_CANARY_OCCURRENCES",
]);
export function validateObservedPilotReview008(
  value: unknown,
  now = Date.now(),
): readonly string[] {
  if (!record(value)) return ["LIMITED_PILOT_REPORT_MISSING"];
  const reasons: string[] = [];
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "OBSERVED_CORPORATE_LIMITED_PILOT" ||
    value.sourceMode !== "CORPORATE_OBSERVATION"
  )
    reasons.push("LIMITED_PILOT_SCHEMA_OR_SOURCE_INVALID");
  if (
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.runId !== "string"
  )
    reasons.push("LIMITED_PILOT_SCOPE_INVALID");
  if (
    !Number.isSafeInteger(value.sampleSize) ||
    !Number.isSafeInteger(value.minimumSample) ||
    Number(value.sampleSize) < Number(value.minimumSample) ||
    Number(value.minimumSample) < 1
  )
    reasons.push("LIMITED_PILOT_SAMPLE_INSUFFICIENT");
  if (
    typeof value.windowEndAt !== "string" ||
    !Number.isFinite(Date.parse(value.windowEndAt)) ||
    now < Date.parse(value.windowEndAt)
  )
    reasons.push("LIMITED_PILOT_WINDOW_NOT_ELAPSED");
  if (
    !Array.isArray(value.sourceEvidenceHashes) ||
    value.sourceEvidenceHashes.length === 0 ||
    value.sourceEvidenceHashes.some(
      (item) => typeof item !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(item),
    )
  )
    reasons.push("LIMITED_PILOT_PROVENANCE_MISSING");
  if (
    !Array.isArray(value.guardrails) ||
    value.guardrails.length !== 7 ||
    new Set(value.guardrails.filter(record).map((item) => item.key)).size !== 7 ||
    value.guardrails.some(
      (item) =>
        !record(item) ||
        !guardrails.has(String(item.key)) ||
        item.state !== "PASS" ||
        item.independentlyObserved !== true,
    )
  )
    reasons.push("LIMITED_PILOT_GUARDRAILS_INCOMPLETE");
  if (
    !record(value.externalEffects) ||
    value.externalEffects.source !== "INDEPENDENT" ||
    !Number.isSafeInteger(value.externalEffects.writes) ||
    !Number.isSafeInteger(value.externalEffects.duplicates) ||
    Number(value.externalEffects.duplicates) !== 0
  )
    reasons.push("LIMITED_PILOT_EFFECT_COUNTS_INVALID");
  if (
    !Array.isArray(value.metrics) ||
    value.metrics.length === 0 ||
    value.metrics.some(
      (item) =>
        !record(item) ||
        item.value === null ||
        !Number.isFinite(item.denominator) ||
        Number(item.denominator) <= 0,
    )
  )
    reasons.push("LIMITED_PILOT_METRICS_INCOMPLETE");
  const reviews = Array.isArray(value.reviews) ? value.reviews : [];
  if (
    reviews.length !== 2 ||
    new Set(reviews.filter(record).map((item) => item.role)).size !== 2 ||
    !["QA_LEAD", "SPONSOR"].every((role) =>
      reviews.some(
        (item: unknown) =>
          record(item) &&
          item.kind === "HUMAN" &&
          item.role === role &&
          typeof item.principalId === "string" &&
          typeof item.authorizationRef === "string",
      ),
    )
  )
    reasons.push("LIMITED_PILOT_HUMAN_REVIEW_INVALID");
  if (
    !Number.isFinite(value.operatorLoadMinutes) ||
    Number(value.operatorLoadMinutes) < 0 ||
    !Array.isArray(value.limitations) ||
    !Array.isArray(value.residualRisks)
  )
    reasons.push("LIMITED_PILOT_CONTEXT_INCOMPLETE");
  return Object.freeze([...new Set(reasons)]);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const inputPath = args[0] === "--input" && args.length === 2 ? args[1] : undefined;
  if (args.length && !inputPath) throw new Error("REVIEW_ARGUMENT_INVALID");
  let value: unknown = null;
  try {
    if (inputPath)
      value = JSON.parse(readFileSync(safeFile(ROOT_008, inputPath), "utf8")) as unknown;
  } catch {
    value = null;
  }
  const reasons = [...validateObservedPilotReview008(value)];
  const status = reasons.length ? ("BLOCKED_INPUT" as const) : ("PASS" as const);
  const scope =
    record(value) && typeof value.workspaceId === "string" && typeof value.projectId === "string"
      ? { workspaceId: value.workspaceId, projectIds: [value.projectId] }
      : { workspaceId: "corporate-input-required", projectIds: ["corporate-project-required"] };
  const runId = `review-${randomUUID()}`,
    startedAt = new Date().toISOString(),
    fingerprints = currentFingerprints008();
  const detailPath = `reports/${FEATURE_008}/evidence/${runId}/observed-pilot-review.json`;
  write008Json(detailPath, {
    inputPath: inputPath ?? null,
    status,
    reasonCodes: reasons,
    actualElapsedPilot: status === "PASS",
  });
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "review",
    status,
    deploymentProfile: "pilot",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks: [
      {
        id: "actual-observed-pilot-review",
        status,
        evidence: [evidenceRef008(ROOT_008, detailPath)],
        reasonCodes: reasons,
      },
    ],
    prerequisites: [],
    reasonCodes: reasons,
  };
  const ref = writeGateReport008(ROOT_008, report, {
    now: Date.now(),
    maximumAgeMs: 3_600_000,
    scope,
    fingerprints,
    allowedExecutors: ["local-cli"],
  });
  write008Json(`reports/${FEATURE_008}/review.json`, {
    status,
    report: ref,
    actualObservedPilot: status === "PASS",
  });
  console.log(`[verify:008:review] ${status}; report=${ref.path}`);
  if (status !== "PASS") process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
