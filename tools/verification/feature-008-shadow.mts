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
  type EvidenceRef008,
  evidenceRef008,
  type GateReport008,
  readGateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

export function validateCorporateShadowEvidence008(value: unknown): readonly string[] {
  if (!record(value)) return ["SHADOW_EVIDENCE_MISSING"];
  const reasons: string[] = [];
  const allowed = [
    "schemaVersion",
    "kind",
    "workspaceId",
    "projectId",
    "deploymentRef",
    "cohortRef",
    "comparisonProtocolRef",
    "prerequisites",
    "observationCount",
    "differenceReportHash",
    "independentProviderWriteCount",
    "providerObservationHash",
    "review",
    "startedAt",
    "finishedAt",
  ];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.schemaVersion !== 1 ||
    value.kind !== "CORPORATE_SHADOW"
  )
    reasons.push("SHADOW_SCHEMA_INVALID");
  for (const key of [
    "workspaceId",
    "projectId",
    "deploymentRef",
    "cohortRef",
    "comparisonProtocolRef",
    "differenceReportHash",
    "providerObservationHash",
    "startedAt",
    "finishedAt",
  ] as const)
    if (typeof value[key] !== "string" || !value[key]) reasons.push(`SHADOW_FIELD_INVALID:${key}`);
  if (!Number.isSafeInteger(value.observationCount) || Number(value.observationCount) < 1)
    reasons.push("SHADOW_OBSERVATIONS_MISSING");
  if (value.independentProviderWriteCount !== 0)
    reasons.push("SHADOW_EXTERNAL_WRITE_COUNT_NONZERO_OR_UNKNOWN");
  if (
    !record(value.review) ||
    value.review.kind !== "HUMAN" ||
    value.review.role !== "QA_LEAD" ||
    typeof value.review.principalId !== "string" ||
    typeof value.review.reviewedAt !== "string" ||
    value.review.differenceReportHash !== value.differenceReportHash
  )
    reasons.push("SHADOW_HUMAN_REVIEW_INVALID");
  if (
    !record(value.prerequisites) ||
    !["integration", "security", "recovery"].every((key) =>
      record((value.prerequisites as Record<string, unknown>)[key]),
    )
  )
    reasons.push("SHADOW_PREREQUISITES_MISSING");
  if (
    !Number.isFinite(Date.parse(String(value.startedAt))) ||
    Date.parse(String(value.finishedAt)) <= Date.parse(String(value.startedAt))
  )
    reasons.push("SHADOW_WINDOW_INVALID");
  return Object.freeze([...new Set(reasons)]);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const inputPath = args[0] === "--input" && args.length === 2 ? args[1] : undefined;
  if (args.length && !inputPath) throw new Error("SHADOW_ARGUMENT_INVALID");
  const fingerprints = currentFingerprints008();
  const startedAt = new Date().toISOString();
  let value: unknown = null;
  try {
    if (inputPath)
      value = JSON.parse(readFileSync(safeFile(ROOT_008, inputPath), "utf8")) as unknown;
  } catch {
    value = null;
  }
  const reasons = [...validateCorporateShadowEvidence008(value)];
  const scope =
    record(value) && typeof value.workspaceId === "string" && typeof value.projectId === "string"
      ? { workspaceId: value.workspaceId, projectIds: [value.projectId] }
      : { workspaceId: "corporate-input-required", projectIds: ["corporate-project-required"] };
  const prerequisites: EvidenceRef008[] = [];
  if (reasons.length === 0 && record(value) && record(value.prerequisites)) {
    for (const gate of ["integration", "security", "recovery"] as const) {
      try {
        const ref = value.prerequisites[gate] as unknown as EvidenceRef008;
        const report = readGateReport008(ROOT_008, ref, {
          now: Date.now(),
          maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
          scope,
          fingerprints,
          allowedExecutors: ["corporate-ci", "corporate-operator"],
        });
        if (
          report.gate !== gate ||
          report.status !== "PASS" ||
          report.deploymentProfile === "local"
        )
          throw new Error();
        prerequisites.push(ref);
      } catch {
        reasons.push(`SHADOW_PREREQUISITE_NOT_PASS:${gate}`);
      }
    }
  }
  const status = reasons.length ? ("BLOCKED_INPUT" as const) : ("PASS" as const);
  const runId = `shadow-${randomUUID()}`;
  const detailPath = `reports/${FEATURE_008}/evidence/${runId}/shadow-evaluation.json`;
  write008Json(detailPath, {
    inputPath: inputPath ?? null,
    status,
    reasonCodes: reasons,
    independentProviderWriteCount: record(value)
      ? (value.independentProviderWriteCount ?? null)
      : null,
    corporateEvidence: status === "PASS",
  });
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "shadow",
    status,
    deploymentProfile: "pilot",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks: [
      {
        id: "actual-human-reviewed-shadow",
        status,
        evidence: [evidenceRef008(ROOT_008, detailPath)],
        reasonCodes: reasons,
      },
    ],
    prerequisites,
    reasonCodes: reasons,
  };
  const ref = writeGateReport008(ROOT_008, report, {
    now: Date.now(),
    maximumAgeMs: 3_600_000,
    scope,
    fingerprints,
    allowedExecutors: ["local-cli"],
  });
  write008Json(`reports/${FEATURE_008}/shadow.json`, {
    status,
    report: ref,
    actualCorporateShadow: status === "PASS",
  });
  console.log(`[verify:008:shadow] ${status}; report=${ref.path}`);
  if (status !== "PASS") process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
