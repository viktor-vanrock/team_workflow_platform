import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { containsSensitiveValue008, validateInputPackage008 } from "./feature-008-inputs.mts";
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

export function validateCorporateN2Evidence008(value: unknown): readonly string[] {
  if (!record(value)) return ["N2_EVIDENCE_MISSING"];
  const reasons: string[] = [];
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "CORPORATE_N2_CONFORMANCE" ||
    value.sourceMode !== "REAL_NON_PROD"
  )
    reasons.push("N2_EVIDENCE_SCHEMA_INVALID");
  if (containsSensitiveValue008(value)) reasons.push("N2_EVIDENCE_CONTAINS_SECRET");
  const providers = Array.isArray(value.providers) ? value.providers : [];
  for (const provider of ["JIRA", "GITLAB", "MATTERMOST"]) {
    const item = providers.find(
      (candidate) => record(candidate) && candidate.provider === provider,
    );
    if (
      !record(item) ||
      item.executed !== true ||
      item.scopeAuthorized !== true ||
      item.independentObservation !== true ||
      typeof item.evidenceHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.evidenceHash)
    )
      reasons.push(`N2_PROVIDER_EVIDENCE_INVALID:${provider}`);
  }
  for (const key of ["identity", "vault", "ingress", "telemetry"] as const) {
    const item = value[key];
    if (
      !record(item) ||
      item.executed !== true ||
      item.status !== "PASS" ||
      typeof item.evidenceHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.evidenceHash)
    )
      reasons.push(`N2_BOUNDARY_EVIDENCE_INVALID:${key}`);
  }
  if (
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(Date.parse(value.finishedAt)) ||
    Date.parse(value.finishedAt) <= Date.parse(value.startedAt)
  )
    reasons.push("N2_SCOPE_OR_WINDOW_INVALID");
  return Object.freeze([...new Set(reasons)]);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const inputPath = args[0] === "--input" && args.length === 2 ? args[1] : undefined;
  if (args.length > 0 && inputPath === undefined) throw new Error("INTEGRATION_ARGUMENT_INVALID");
  const evidencePath = process.env.AWP_008_N2_EVIDENCE_BUNDLE?.trim();
  let input: unknown = null;
  let evidence: unknown = null;
  try {
    if (inputPath)
      input = JSON.parse(readFileSync(safeFile(ROOT_008, inputPath), "utf8")) as unknown;
  } catch {
    input = null;
  }
  try {
    if (evidencePath)
      evidence = JSON.parse(readFileSync(safeFile(ROOT_008, evidencePath), "utf8")) as unknown;
  } catch {
    evidence = null;
  }
  const inputReasons: string[] = [];
  if (!record(input) || input.profile === "local")
    inputReasons.push("CORPORATE_INPUT_PACKAGE_MISSING");
  else {
    const validation = validateInputPackage008(input, "N2");
    if (validation.status !== "PASS") {
      inputReasons.push(
        "CORPORATE_INPUT_PACKAGE_INVALID",
        ...validation.reasonCodes,
        ...validation.missingInputIds.map((id) => `CORPORATE_INPUT_MISSING:${id}`),
      );
    }
  }
  const reasons = [...inputReasons, ...validateCorporateN2Evidence008(evidence)];
  const status = reasons.length === 0 ? ("PASS" as const) : ("BLOCKED_INPUT" as const);
  const scope =
    record(evidence) &&
    typeof evidence.workspaceId === "string" &&
    typeof evidence.projectId === "string"
      ? { workspaceId: evidence.workspaceId, projectIds: [evidence.projectId] }
      : { workspaceId: "corporate-input-required", projectIds: ["corporate-project-required"] };
  const runId = `integration-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const fingerprints = currentFingerprints008();
  const detailPath = `reports/${FEATURE_008}/evidence/${runId}/n2-evaluation.json`;
  write008Json(detailPath, {
    inputPath: inputPath ?? null,
    evidencePath: evidencePath ?? null,
    status,
    reasonCodes: reasons,
    actualCorporateExecution: status === "PASS",
  });
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "integration",
    status,
    deploymentProfile: "integration",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks: [
      {
        id: "actual-corporate-n2-conformance",
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
  write008Json(`reports/${FEATURE_008}/integration.json`, {
    status,
    report: ref,
    actualCorporateExecution: status === "PASS",
  });
  console.log(`[verify:008:integration] ${status}; report=${ref.path}`);
  if (status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
