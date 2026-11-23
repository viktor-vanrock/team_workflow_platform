import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FEATURE_008, ROOT_008, write008Json } from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  evidenceRef008,
  type GateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

export interface AuditCoverageEffect008 {
  readonly effectKey: string;
  readonly effectCount: number;
  readonly recordedAt: string;
}
export interface AuditCoverageCommand008 {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly effectKey: string;
  readonly state: string;
  readonly correlationId: string;
  readonly causationId: string;
}
export interface AuditCoverageEvent008 {
  readonly action: string;
  readonly outcome: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly values: Readonly<Record<string, unknown>>;
}
export interface AuditCoverageObservation008 {
  readonly providerEffects: readonly AuditCoverageEffect008[] | null;
  readonly commands: readonly AuditCoverageCommand008[] | null;
  readonly events: readonly AuditCoverageEvent008[] | null;
  readonly expectedEffectKeys: readonly string[];
  readonly approvalRequiredEffectKeys: readonly string[];
}

export function evaluateAuditCoverage008(input: AuditCoverageObservation008) {
  const unknown =
    input.providerEffects === null || input.commands === null || input.events === null;
  const reasons: string[] = [];
  if (unknown) reasons.push("AUDIT_COVERAGE_UNOBSERVED");
  const expected = new Set(input.expectedEffectKeys),
    approvals = new Set(input.approvalRequiredEffectKeys);
  if (
    expected.size !== input.expectedEffectKeys.length ||
    [...approvals].some((key) => !expected.has(key))
  )
    reasons.push("AUDIT_COVERAGE_INPUT_INVALID");
  const results = unknown
    ? []
    : input.expectedEffectKeys.map((effectKey) => {
        const effects = input.providerEffects!.filter((value) => value.effectKey === effectKey);
        const commands = input.commands!.filter((value) => value.effectKey === effectKey);
        const events = input.events!.filter(
          (value) => value.values.effectIdempotencyKey === effectKey,
        );
        const command = commands[0];
        const intent = events.filter(
          (value) => value.action === "sample.record.intent" && value.outcome === "ACCEPTED",
        );
        const result = events.filter(
          (value) => value.action === "sample.record.result" && value.outcome === "SUCCEEDED",
        );
        const approval = events.filter(
          (value) => value.action === "sample.record.approve" && value.outcome === "ACCEPTED",
        );
        const exactScope =
          !!command &&
          [...intent, ...result, ...approval].every(
            (value) =>
              value.workspaceId === command.workspaceId && value.projectId === command.projectId,
          );
        const exactCorrelation =
          !!command &&
          [...intent, ...result, ...approval].every(
            (value) =>
              value.correlationId === command.correlationId &&
              value.causationId === command.causationId,
          );
        const passed =
          effects.length === 1 &&
          effects[0]!.effectCount === 1 &&
          commands.length === 1 &&
          command!.state === "CONFIRMED" &&
          intent.length === 1 &&
          result.length === 1 &&
          (!approvals.has(effectKey) || approval.length === 1) &&
          exactScope &&
          exactCorrelation;
        return {
          effectKey,
          status: passed ? ("PASS" as const) : ("FAIL" as const),
          providerRows: effects.length,
          providerEffectCount: effects.length === 1 ? effects[0]!.effectCount : null,
          commandRows: commands.length,
          intentAuditRows: intent.length,
          resultAuditRows: result.length,
          approvalAuditRows: approval.length,
          exactScope,
          exactCorrelation,
        };
      });
  if (results.some((value) => value.status === "FAIL"))
    reasons.push("EFFECT_AUDIT_COVERAGE_INCOMPLETE");
  return Object.freeze({
    schemaVersion: "audit-coverage@1.0.0",
    status: reasons.length ? ("FAIL" as const) : ("PASS" as const),
    measurements: Object.freeze({
      observedEffects: unknown ? null : input.providerEffects!.length,
      expectedEffects: input.expectedEffectKeys.length,
      coveredEffects: unknown ? null : results.filter((value) => value.status === "PASS").length,
      duplicateEffects: unknown
        ? null
        : input.providerEffects!.filter((value) => value.effectCount !== 1).length,
      unmatchedAuditEvents: unknown
        ? null
        : input.events!.filter(
            (value) => !expected.has(String(value.values.effectIdempotencyKey ?? "")),
          ).length,
    }),
    results: Object.freeze(results),
    reasonCodes: Object.freeze(reasons),
  });
}

const safeKey = (value: string) => {
  if (!/^[a-zA-Z0-9:._-]{1,255}$/u.test(value)) throw new Error("AUDIT_COVERAGE_KEY_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
};
function postgresJson(container: string, database: "awp" | "awp_mock", query: string): unknown[] {
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "awp_bootstrap",
      "-d",
      database,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { cwd: ROOT_008, encoding: "utf8", timeout: 15_000 },
  );
  if (result.status !== 0 || result.error)
    throw new Error(
      `AUDIT_COVERAGE_DATABASE_UNAVAILABLE:${(result.stderr || result.stdout).trim()}`,
    );
  return JSON.parse(result.stdout.trim() || "[]") as unknown[];
}
async function json<T>(origin: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`AUDIT_COVERAGE_HTTP_${response.status}`);
  return (await response.json()) as T;
}
const authorized = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function run(): Promise<void> {
  if (process.argv.slice(2).some((value) => value !== "--"))
    throw new Error("UNKNOWN_AUDIT_COVERAGE_ARGUMENT");
  const startedAt = new Date().toISOString(),
    fingerprints = currentFingerprints008();
  const api = process.env.AWP_API_URL ?? "http://127.0.0.1:5300",
    project = process.env.AWP_LOCAL_PROJECT_NAME?.trim() || "awp-local-pilot-dev";
  const container = `${project}-postgres-1`,
    suffix = randomUUID();
  const token = async (personaKey: string) =>
    (
      await json<{ accessToken: string }>(api, "/local/persona/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaKey }),
      })
    ).accessToken;
  const [executor, owner] = await Promise.all([token("executor.alpha"), token("owner.local")]);
  const direct = await json<{ id: string; correlationId: string }>(
    api,
    "/local/walking-skeleton/commands",
    authorized(executor, {
      recordKey: `audit-direct-${suffix}`,
      message: "audit coverage",
      clientRequestKey: `audit-direct-${suffix}`,
      approvalRequired: false,
    }),
  );
  const pending = await json<{ approvalId: string }>(
    api,
    "/local/walking-skeleton/commands",
    authorized(executor, {
      recordKey: `audit-approved-${suffix}`,
      message: "audit coverage approved",
      clientRequestKey: `audit-approved-${suffix}`,
      approvalRequired: true,
    }),
  );
  const approved = await json<{ commandId: string }>(
    api,
    `/local/walking-skeleton/approvals/${pending.approvalId}/approve`,
    authorized(owner, {}),
  );
  const keys = [
    `local:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001:audit-direct-${suffix}`,
    `local:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001:audit-approved-${suffix}`,
  ];
  const list = keys.map(safeKey).join(",");
  const effects = postgresJson(
    container,
    "awp_mock",
    `SELECT COALESCE(json_agg(row_to_json(x)),'[]'::json)::text FROM (SELECT effect_idempotency_key AS "effectKey",effect_count AS "effectCount",recorded_at AS "recordedAt" FROM mock_effects WHERE effect_idempotency_key IN (${list})) x`,
  ) as unknown as AuditCoverageEffect008[];
  const commands = postgresJson(
    container,
    "awp",
    `SELECT COALESCE(json_agg(row_to_json(x)),'[]'::json)::text FROM (SELECT id::text,workspace_id::text AS "workspaceId",project_id::text AS "projectId",effect_idempotency_key AS "effectKey",state,correlation_id::text AS "correlationId",causation_id::text AS "causationId" FROM connector_commands WHERE effect_idempotency_key IN (${list})) x`,
  ) as unknown as AuditCoverageCommand008[];
  const events = postgresJson(
    container,
    "awp",
    `SELECT COALESCE(json_agg(row_to_json(x)),'[]'::json)::text FROM (SELECT action,outcome,workspace_id::text AS "workspaceId",project_id::text AS "projectId",correlation_id::text AS "correlationId",causation_id::text AS "causationId",attributes->'values' AS values FROM audit_events WHERE attributes->'values'->>'effectIdempotencyKey' IN (${list})) x`,
  ) as unknown as AuditCoverageEvent008[];
  const coverage = evaluateAuditCoverage008({
    providerEffects: effects,
    commands,
    events,
    expectedEffectKeys: keys,
    approvalRequiredEffectKeys: [keys[1]!],
  });
  const runId = `audit-${suffix}`,
    evidencePath = `reports/${FEATURE_008}/evidence/${runId}/coverage.json`;
  write008Json(evidencePath, {
    mode: "DEVELOPMENT_MOCKS",
    commandIds: [direct.id, approved.commandId],
    observationSources: ["awp_mock.mock_effects", "awp.connector_commands", "awp.audit_events"],
    coverage,
  });
  const unchanged = JSON.stringify(currentFingerprints008()) === JSON.stringify(fingerprints),
    scope = {
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectIds: ["20000000-0000-4000-8000-000000000001"],
    };
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "audit-coverage",
    status: coverage.status === "PASS" && unchanged ? "PASS" : "FAIL",
    deploymentProfile: "local",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    prerequisites: [],
    reasonCodes: coverage.status === "PASS" && unchanged ? [] : ["AUDIT_COVERAGE_FAILED"],
    checks: [
      {
        id: "effect-audit-coverage",
        status: coverage.status,
        evidence: [evidenceRef008(ROOT_008, evidencePath)],
        reasonCodes: coverage.reasonCodes,
      },
      {
        id: "unchanged-source",
        status: unchanged ? "PASS" : "FAIL",
        evidence: [evidenceRef008(ROOT_008, evidencePath)],
        reasonCodes: unchanged ? [] : ["SOURCE_CHANGED"],
      },
    ],
  };
  const ref = writeGateReport008(ROOT_008, report, {
    now: Date.now(),
    maximumAgeMs: 3_600_000,
    scope,
    fingerprints,
    allowedExecutors: ["local-cli"],
  });
  write008Json(`reports/${FEATURE_008}/audit-coverage.json`, {
    status: report.status,
    report: ref,
    mode: "DEVELOPMENT_MOCKS",
    measurements: coverage.measurements,
  });
  console.log(
    `[verify:008:audit] ${report.status}; effects=${String(coverage.measurements.observedEffects)}; covered=${String(coverage.measurements.coveredEffects)}; report=${ref.path}`,
  );
  if (report.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
