import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FEATURE_008, record, ROOT_008, write008Json } from "./feature-008-prerequisites.mts";

export interface TraceEntry008 {
  readonly id: string;
  readonly tasks: readonly string[];
  readonly plannedFiles: readonly string[];
  readonly assertionId: string;
}
export const TRACE_008: readonly TraceEntry008[] = Object.freeze([
  {
    id: "FR-008-001",
    tasks: ["T011", "T026", "T028", "T033"],
    plannedFiles: [
      "infra/observability/otel-collector.yaml",
      "packages/platform-runtime-nest/src/auth/oidc-auth.guard.ts",
      "packages/platform-runtime-nest/src/observability/bootstrap.ts",
      "packages/runtime-composition/src/config/environment.ts",
      "packages/runtime-composition/src/pilot/deployment-config.ts",
      "packages/runtime-composition/src/security/corporate-identity.ts",
      "packages/runtime-composition/src/security/vault-secret-resolver.ts",
    ],
    assertionId: "FR-008-001",
  },
  {
    id: "FR-008-002",
    tasks: ["T030", "T045", "T057"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/connector-factories.ts",
      "packages/runtime-composition/src/pilot/provider-conformance.ts",
      "tools/verification/feature-008-integration.mts",
    ],
    assertionId: "FR-008-002",
  },
  {
    id: "FR-008-003",
    tasks: ["T031", "T052", "T065"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "packages/runtime-composition/src/pilot/artifact-source-policy.ts",
      "packages/runtime-composition/src/pilot/degradation-policy.ts",
      "packages/runtime-composition/src/storage/corporate-object-storage.ts",
      "tools/verification/008-hermes-evaluation.mts",
    ],
    assertionId: "FR-008-003",
  },
  {
    id: "FR-008-004",
    tasks: ["T008", "T011", "T004", "T037"],
    plannedFiles: [
      "config/pilot/local-inputs.json",
      "packages/runtime-composition/src/config/environment.ts",
      "packages/runtime-composition/src/pilot/deployment-config.ts",
      "packages/runtime-composition/src/pilot/startup.ts",
      "tests/unit/008/deployment-policy.spec.ts",
      "tools/verification/feature-008-inputs.mts",
    ],
    assertionId: "FR-008-004",
  },
  {
    id: "FR-008-005",
    tasks: ["T008", "T037", "T061"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/startup.ts",
      "tests/integration/security/008/network-policy.spec.ts",
      "tests/unit/008/deployment-policy.spec.ts",
    ],
    assertionId: "FR-008-005",
  },
  {
    id: "FR-008-006",
    tasks: ["T045", "T042", "T043", "T057"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/provider-conformance.ts",
      "tests/integration/008/degradation-matrix.spec.ts",
      "tests/integration/008/uncertain-effects.spec.ts",
      "tools/verification/feature-008-integration.mts",
    ],
    assertionId: "FR-008-006",
  },
  {
    id: "FR-008-007",
    tasks: ["T041", "T046", "T047", "T048", "T049"],
    plannedFiles: [
      "config/pilot/ingress-policy.example.json",
      "packages/connector-gitlab/src/webhooks/gitlab-webhook-normalizer.ts",
      "packages/connector-jira/src/webhooks/jira-webhook-normalizer.ts",
      "packages/connector-mattermost/src/ingress/callback-auth.ts",
      "packages/runtime-composition/src/gitlab/corporate-ingress.ts",
      "packages/runtime-composition/src/jira/corporate-ingress.ts",
      "packages/runtime-composition/src/mattermost/corporate-ingress.ts",
      "packages/runtime-composition/src/pilot/trusted-ingress.ts",
      "tests/contract/008/provider-ingress.spec.ts",
    ],
    assertionId: "FR-008-007",
  },
  {
    id: "FR-008-008",
    tasks: ["T050", "T051", "T059"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/effect-confirmation.ts",
      "packages/runtime-composition/src/pilot/retry-policy.ts",
      "tests/integration/security/008/exact-approvals.spec.ts",
    ],
    assertionId: "FR-008-008",
  },
  {
    id: "FR-008-009",
    tasks: ["T050", "T078", "T072"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/effect-confirmation.ts",
      "packages/runtime-composition/src/recovery/reconcile.ts",
      "tests/integration/008/post-backup-effects.spec.ts",
    ],
    assertionId: "FR-008-009",
  },
  {
    id: "FR-008-010",
    tasks: ["T032", "T035", "T036"],
    plannedFiles: [
      "apps/api/src/extensions/pilot/pilot.controller.ts",
      "apps/web/src/routes/pilot/readiness.tsx",
      "apps/worker/src/app.module.ts",
      "packages/runtime-composition/src/pilot/maintenance-workers.ts",
      "packages/runtime-composition/src/pilot/readiness-query.ts",
    ],
    assertionId: "FR-008-010",
  },
  {
    id: "FR-008-011",
    tasks: ["T058", "T059", "T060", "T061"],
    plannedFiles: [
      "tests/integration/security/008/access-boundaries.spec.ts",
      "tests/integration/security/008/exact-approvals.spec.ts",
      "tests/integration/security/008/network-policy.spec.ts",
      "tests/integration/security/008/secret-canaries.spec.ts",
    ],
    assertionId: "FR-008-011",
  },
  {
    id: "FR-008-012",
    tasks: ["T016", "T067", "T094"],
    plannedFiles: [
      "packages/platform-runtime-nest/src/auth/pilot-authorization.ts",
      "packages/runtime-composition/src/onboarding/action-consumers.ts",
      "tools/verification/008-audit-coverage.mts",
    ],
    assertionId: "FR-008-012",
  },
  {
    id: "FR-008-013",
    tasks: ["T059", "T086", "T094", "T044"],
    plannedFiles: [
      "packages/runtime-composition/src/onboarding/action-consumers.ts",
      "tests/integration/008/dead-letter-replay.spec.ts",
      "tests/integration/008/pilot-activation.spec.ts",
      "tests/integration/security/008/exact-approvals.spec.ts",
    ],
    assertionId: "FR-008-013",
  },
  {
    id: "FR-008-014",
    tasks: ["T024", "T034", "T060"],
    plannedFiles: [
      "packages/platform-runtime-nest/src/observability/telemetry.ts",
      "tests/integration/008/telemetry-export.spec.ts",
      "tests/integration/security/008/secret-canaries.spec.ts",
    ],
    assertionId: "FR-008-014",
  },
  {
    id: "FR-008-015",
    tasks: ["T068", "T069"],
    plannedFiles: [
      "tools/verification/008-security-scans.mts",
      "tools/verification/feature-008-security.mts",
    ],
    assertionId: "FR-008-015",
  },
  {
    id: "FR-008-016",
    tasks: ["T042", "T072", "T078"],
    plannedFiles: [
      "packages/runtime-composition/src/recovery/reconcile.ts",
      "tests/integration/008/post-backup-effects.spec.ts",
      "tests/integration/008/uncertain-effects.spec.ts",
    ],
    assertionId: "FR-008-016",
  },
  {
    id: "FR-008-017",
    tasks: ["T051", "T043"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/retry-policy.ts",
      "tests/integration/008/degradation-matrix.spec.ts",
    ],
    assertionId: "FR-008-017",
  },
  {
    id: "FR-008-018",
    tasks: ["T053", "T044", "T054"],
    plannedFiles: [
      "apps/api/src/extensions/pilot/pilot.controller.ts",
      "apps/web/src/routes/pilot/dead-letters.tsx",
      "packages/runtime-composition/src/pilot/dead-letter-service.ts",
      "tests/integration/008/dead-letter-replay.spec.ts",
    ],
    assertionId: "FR-008-018",
  },
  {
    id: "FR-008-019",
    tasks: ["T074", "T079"],
    plannedFiles: [
      "packages/runtime-composition/src/recovery/verify.ts",
      "tools/recovery/008-backup.mts",
    ],
    assertionId: "FR-008-019",
  },
  {
    id: "FR-008-020",
    tasks: ["T071", "T073", "T080", "T084"],
    plannedFiles: [
      "tests/integration/008/isolated-restore.spec.ts",
      "tests/integration/008/restored-evidence.spec.ts",
      "tools/recovery/008-measurements.mts",
      "tools/verification/feature-008-recovery.mts",
    ],
    assertionId: "FR-008-020",
  },
  {
    id: "FR-008-021",
    tasks: ["T077", "T078", "T072"],
    plannedFiles: [
      "packages/runtime-composition/src/recovery/fence.ts",
      "packages/runtime-composition/src/recovery/reconcile.ts",
      "tests/integration/008/post-backup-effects.spec.ts",
    ],
    assertionId: "FR-008-021",
  },
  {
    id: "FR-008-022",
    tasks: ["T062", "T065"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "tests/fixtures/008/hermes-corpus.json",
      "tools/verification/008-hermes-evaluation.mts",
    ],
    assertionId: "FR-008-022",
  },
  {
    id: "FR-008-023",
    tasks: ["T062", "T065", "T070"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "tests/fixtures/008/hermes-corpus.json",
      "tools/verification/008-hermes-evaluation.mts",
      "tools/verification/008-us3-checkpoint.mts",
    ],
    assertionId: "FR-008-023",
  },
  {
    id: "FR-008-024",
    tasks: ["T062", "T058", "T063", "T065"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "packages/runtime-composition/src/pilot/effect-guard.ts",
      "tests/fixtures/008/hermes-corpus.json",
      "tests/integration/security/008/access-boundaries.spec.ts",
      "tools/verification/008-hermes-evaluation.mts",
    ],
    assertionId: "FR-008-024",
  },
  {
    id: "FR-008-025",
    tasks: ["T066", "T065"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation-policy.ts",
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "tools/verification/008-hermes-evaluation.mts",
    ],
    assertionId: "FR-008-025",
  },
  {
    id: "FR-008-026",
    tasks: ["T065", "T052", "T043"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "packages/runtime-composition/src/pilot/degradation-policy.ts",
      "tests/integration/008/degradation-matrix.spec.ts",
      "tools/verification/008-hermes-evaluation.mts",
    ],
    assertionId: "FR-008-026",
  },
  {
    id: "FR-008-027",
    tasks: ["T091", "T092", "T085"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/baseline-service.ts",
      "packages/runtime-composition/src/pilot/measurement-protocol.ts",
      "tests/unit/008/pilot-measurements.spec.ts",
    ],
    assertionId: "FR-008-027",
  },
  {
    id: "FR-008-028",
    tasks: ["T095", "T088", "T094"],
    plannedFiles: [
      "packages/runtime-composition/src/onboarding/action-consumers.ts",
      "packages/runtime-composition/src/pilot/cohort-service.ts",
      "tests/integration/008/pilot-cohort.spec.ts",
    ],
    assertionId: "FR-008-028",
  },
  {
    id: "FR-008-029",
    tasks: ["T090", "T099", "T100"],
    plannedFiles: [
      "apps/api/src/extensions/pilot/pilot.controller.ts",
      "apps/web/src/routes/pilot/pilot-run.tsx",
      "packages/competency-qa/src/application/pilot-metrics.ts",
      "packages/runtime-composition/src/pilot/metric-sources.ts",
    ],
    assertionId: "FR-008-029",
  },
  {
    id: "FR-008-030",
    tasks: ["T097", "T067", "T089"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/guardrail-service.ts",
      "tests/integration/008/pilot-review.spec.ts",
      "tools/verification/008-audit-coverage.mts",
    ],
    assertionId: "FR-008-030",
  },
  {
    id: "FR-008-031",
    tasks: ["T098", "T106", "T102"],
    plannedFiles: [
      "docs/runbooks/pilot-operation.md",
      "packages/runtime-composition/src/pilot/review-service.ts",
      "tools/verification/feature-008-review.mts",
    ],
    assertionId: "FR-008-031",
  },
  {
    id: "SC-008-001",
    tasks: ["T057", "T040", "T114"],
    plannedFiles: [
      "config/pilot/provider-capabilities.json",
      "reports/008-pilot-hardening-and-conformance/readiness.json",
      "tools/verification/feature-008-integration.mts",
    ],
    assertionId: "SC-008-001",
  },
  {
    id: "SC-008-002",
    tasks: ["T056", "T043"],
    plannedFiles: [
      "tests/integration/008/degradation-matrix.spec.ts",
      "tools/verification/008-us2-checkpoint.mts",
    ],
    assertionId: "SC-008-002",
  },
  {
    id: "SC-008-003",
    tasks: ["T070", "T058"],
    plannedFiles: [
      "tests/integration/security/008/access-boundaries.spec.ts",
      "tools/verification/008-us3-checkpoint.mts",
    ],
    assertionId: "SC-008-003",
  },
  {
    id: "SC-008-004",
    tasks: ["T084", "T072"],
    plannedFiles: [
      "tests/integration/008/post-backup-effects.spec.ts",
      "tools/verification/feature-008-recovery.mts",
    ],
    assertionId: "SC-008-004",
  },
  {
    id: "SC-008-005",
    tasks: ["T024", "T067", "T105"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/observation-worker.ts",
      "reports/008-pilot-hardening-and-conformance/limited-pilot.json",
      "tests/integration/008/telemetry-export.spec.ts",
      "tools/verification/008-audit-coverage.mts",
    ],
    assertionId: "SC-008-005",
  },
  {
    id: "SC-008-006",
    tasks: ["T097", "T105", "T106"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/guardrail-service.ts",
      "packages/runtime-composition/src/pilot/observation-worker.ts",
      "reports/008-pilot-hardening-and-conformance/limited-pilot.json",
      "tools/verification/feature-008-review.mts",
    ],
    assertionId: "SC-008-006",
  },
  {
    id: "SC-008-007",
    tasks: ["T098", "T106"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/review-service.ts",
      "tools/verification/feature-008-review.mts",
    ],
    assertionId: "SC-008-007",
  },
  {
    id: "GR-008-001",
    tasks: ["T058", "T095"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/cohort-service.ts",
      "tests/integration/security/008/access-boundaries.spec.ts",
    ],
    assertionId: "GR-008-001",
  },
  {
    id: "GR-008-002",
    tasks: ["T059", "T067"],
    plannedFiles: [
      "tests/integration/security/008/exact-approvals.spec.ts",
      "tools/verification/008-audit-coverage.mts",
    ],
    assertionId: "GR-008-002",
  },
  {
    id: "GR-008-003",
    tasks: ["T042", "T072"],
    plannedFiles: [
      "tests/integration/008/post-backup-effects.spec.ts",
      "tests/integration/008/uncertain-effects.spec.ts",
    ],
    assertionId: "GR-008-003",
  },
  {
    id: "GR-008-004",
    tasks: ["T067"],
    plannedFiles: ["tools/verification/008-audit-coverage.mts"],
    assertionId: "GR-008-004",
  },
  {
    id: "GR-008-005",
    tasks: ["T073", "T095"],
    plannedFiles: [
      "packages/runtime-composition/src/pilot/cohort-service.ts",
      "tests/integration/008/restored-evidence.spec.ts",
    ],
    assertionId: "GR-008-005",
  },
  {
    id: "GR-008-006",
    tasks: ["T062", "T063", "T065"],
    plannedFiles: [
      "packages/runtime-composition/src/hermes/evaluation.ts",
      "packages/runtime-composition/src/pilot/effect-guard.ts",
      "tests/fixtures/008/hermes-corpus.json",
      "tools/verification/008-hermes-evaluation.mts",
    ],
    assertionId: "GR-008-006",
  },
  {
    id: "GR-008-007",
    tasks: ["T060"],
    plannedFiles: ["tests/integration/security/008/secret-canaries.spec.ts"],
    assertionId: "GR-008-007",
  },
]);
export function validateTraceRegistry008(root = ROOT_008): string[] {
  const spec = readFileSync(resolve(root, `specs/${FEATURE_008}/spec.md`), "utf8"),
    tasks = readFileSync(resolve(root, `specs/${FEATURE_008}/tasks.md`), "utf8");
  const declared = new Set([...spec.matchAll(/\b((?:FR|SC)-008-\d{3})\b/gu)].map((m) => m[1]!));
  const knownTasks = new Set([...tasks.matchAll(/^- \[[ xX]\] (T\d{3})/gmu)].map((m) => m[1]!));
  const errors: string[] = [];
  if (declared.size !== 38) errors.push("REQUIREMENT_SET_CHANGED");
  const ids = TRACE_008.map((e) => e.id);
  if (ids.length !== 45 || new Set(ids).size !== 45) errors.push("TRACE_ID_SET_INVALID");
  for (const id of declared) if (!ids.includes(id)) errors.push(`REQUIREMENT_UNMAPPED:${id}`);
  for (const entry of TRACE_008) {
    if (!entry.tasks.length || !entry.plannedFiles.length || entry.assertionId !== entry.id)
      errors.push(`TRACE_EMPTY:${entry.id}`);
    for (const task of entry.tasks) if (!knownTasks.has(task)) errors.push(`UNKNOWN_TASK:${task}`);
  }
  return errors;
}
export function evaluateTrace008(verifiedReports: readonly unknown[], root = ROOT_008) {
  const text = readFileSync(resolve(root, `specs/${FEATURE_008}/tasks.md`), "utf8"),
    done = new Set([...text.matchAll(/^- \[[xX]\] (T\d{3})/gmu)].map((m) => m[1]!));
  return TRACE_008.map((entry) => {
    const pendingTasks = entry.tasks.filter((t) => !done.has(t));
    const missingFiles = entry.plannedFiles.filter((p) => !existsSync(resolve(root, p)));
    const assertionObserved = verifiedReports.some(
      (r) =>
        record(r) &&
        r.status === "PASS" &&
        Array.isArray(r.checks) &&
        r.checks.some(
          (c: unknown) =>
            record(c) &&
            c.id === entry.assertionId &&
            c.status === "PASS" &&
            Array.isArray(c.evidence) &&
            c.evidence.length > 0,
        ),
    );
    return {
      ...entry,
      status:
        pendingTasks.length === 0 && missingFiles.length === 0 && assertionObserved
          ? "PASS"
          : "NOT_VERIFIED",
      pendingTasks,
      missingFiles,
      assertionObserved,
    };
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.some((a) => a !== "--plan")) throw new Error("UNKNOWN_TRACE_ARGUMENT");
  const errors = validateTraceRegistry008();
  if (args.includes("--plan")) {
    const entries = evaluateTrace008([]),
      result = {
        feature: FEATURE_008,
        registryStatus: errors.length ? "INVALID" : "PLANNED",
        verificationStatus: "NOT_VERIFIED",
        errors,
        required: 45,
        entries,
      };
    write008Json(`reports/${FEATURE_008}/trace-plan.json`, result);
    console.log(`[trace:008] ${result.registryStatus}; FR=31 SC=7 guardrails=7; verified=0`);
    if (errors.length) process.exitCode = 1;
  } else {
    const taskText = readFileSync(resolve(ROOT_008, `specs/${FEATURE_008}/tasks.md`), "utf8"),
      done = new Set([...taskText.matchAll(/^- \[[xX]\] (T\d{3})/gmu)].map((match) => match[1]!));
    const externalBlockers = new Set(["T040", "T057", "T084", "T104", "T105", "T106"]),
      stageStatus = new Map<string, string>();
    for (const stage of ["foundation", "us1", "us2", "us3", "us4", "us5"]) {
      try {
        const value = JSON.parse(
          readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/${stage}.json`), "utf8"),
        ) as { status?: string };
        stageStatus.set(stage, value.status ?? "MISSING");
      } catch {
        stageStatus.set(stage, "MISSING");
      }
    }
    const taskStage = (task: string): string => {
      const number = Number(task.slice(1));
      if (number <= 37) return "foundation";
      if (number <= 51) return "us1";
      if (number <= 57) return "us2";
      if (number <= 70) return "us3";
      if (number <= 86) return "us4";
      return "us5";
    };
    const entries = TRACE_008.map((entry) => {
      const pendingTasks = entry.tasks.filter((task) => !done.has(task)),
        missingFiles = entry.plannedFiles.filter((path) => !existsSync(resolve(ROOT_008, path))),
        evidenceStages = [...new Set(entry.tasks.map(taskStage))],
        assertionObserved = evidenceStages.every((stage) => stageStatus.get(stage) === "PASS"),
        blocked =
          pendingTasks.length > 0 && pendingTasks.every((task) => externalBlockers.has(task));
      return {
        ...entry,
        status: blocked
          ? "BLOCKED_INPUT"
          : pendingTasks.length === 0 && missingFiles.length === 0 && assertionObserved
            ? "PASS"
            : "FAIL",
        pendingTasks,
        missingFiles,
        assertionObserved,
        evidenceStages: evidenceStages.map((stage) => ({
          stage,
          status: stageStatus.get(stage) ?? "MISSING",
        })),
      };
    });
    const localFailures = entries.filter((entry) => entry.status === "FAIL"),
      blocked = entries.filter((entry) => entry.status === "BLOCKED_INPUT"),
      result = {
        schemaVersion: 1,
        feature: FEATURE_008,
        registryStatus: errors.length ? "INVALID" : "PASS",
        verificationStatus:
          errors.length || localFailures.length
            ? "FAIL"
            : blocked.length
              ? "LOCAL_PASS_CORPORATE_BLOCKED"
              : "PASS",
        localEngineeringStatus: errors.length || localFailures.length ? "FAIL" : "PASS",
        corporateStatus: blocked.length ? "BLOCKED_INPUT" : "PASS",
        errors,
        required: 45,
        verified: entries.filter((entry) => entry.status === "PASS").length,
        blocked: blocked.length,
        entries,
      };
    write008Json(`reports/${FEATURE_008}/trace.json`, result);
    console.log(
      `[trace:008] local=${result.localEngineeringStatus}; corporate=${result.corporateStatus}; verified=${result.verified}; blocked=${result.blocked}`,
    );
    if (errors.length || localFailures.length) process.exitCode = 1;
  }
}
