import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  assertFeature005PilotRehearsal,
  readFeature005Metadata,
} from "./feature-005-nonprod-metadata-lib.mts";
import {
  assertFreshBoundFeatureEvidence,
  assertMattermostCompositionEvidence,
  gitLabPilotGateEvidenceHash,
  requiredMetadataString,
  validateGitLabPilotGateEvidence,
} from "./feature-005-pilot-evidence-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(
  workspace,
  "reports/005-gitlab-automated-validation/pilot-rehearsal.json",
);
const args = process.argv.slice(2).filter((value) => value !== "--");
const planOnly = args.includes("--plan");
const metadataIndex = args.indexOf("--metadata");
const metadataArgument =
  metadataIndex >= 0
    ? args[metadataIndex + 1]
    : process.env.AWP_GITLAB_PILOT_REHEARSAL_METADATA?.trim();
const unexpected = args.filter(
  (value, index) => value !== "--metadata" && value !== "--plan" && index !== metadataIndex + 1,
);
if (unexpected.length > 0)
  throw new Error(`Unknown verify:005:pilot-rehearsal arguments: ${unexpected.join(", ")}`);
const tests = Object.freeze([
  "tests/integration/004/us4-outbox-independence.spec.ts",
  "tests/e2e/004-us4-notification-outage.spec.ts",
  "tests/e2e/005-us4-outage-recovery.spec.ts",
]);
if (planOnly) {
  console.log("metadata purpose=PILOT_REHEARSAL; contour=qa-jira-gitlab-mattermost-local");
  console.log(
    ["node", "node_modules/vitest/vitest.mjs", "run", ...tests, "--maxWorkers=1"].join(" "),
  );
  console.log("deploymentApproval=PILOT_REHEARSAL_ONLY; production=DENIED");
  process.exit(0);
}

const startedAt = new Date();
function fail(reasonCode: string): never {
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "005-gitlab-automated-validation",
    gate: "pilot-rehearsal",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status: "FAIL",
    reasonCode,
    deploymentApproval: "DENIED",
    production: "DENIED",
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.error(`[pilot-rehearsal:005] FAIL; reason=${reasonCode}; report: ${reportPath}`);
  process.exit(1);
}
if (!metadataArgument) fail("PILOT_REHEARSAL_METADATA_REQUIRED");

try {
  const loaded = readFeature005Metadata(metadataArgument, workspace);
  assertFeature005PilotRehearsal(loaded.metadata);
  const metadata = loaded.metadata as unknown as Readonly<Record<string, unknown>>;
  assertFreshBoundFeatureEvidence({
    workspace,
    ref: requiredMetadataString(metadata, "feature003EvidenceRef"),
    expectedRef: "reports/003-jira-operational-authority/final-gate.json",
    expectedHash: requiredMetadataString(metadata, "feature003EvidenceHash"),
    expectedFeature: "003-jira-operational-authority",
    tasksPath: "specs/003-jira-operational-authority/tasks.md",
  });
  assertFreshBoundFeatureEvidence({
    workspace,
    ref: requiredMetadataString(metadata, "feature004EvidenceRef"),
    expectedRef: "reports/004-mattermost-hermes-intake/final-gate.json",
    expectedHash: requiredMetadataString(metadata, "feature004EvidenceHash"),
    expectedFeature: "004-mattermost-hermes-intake",
    tasksPath: "specs/004-mattermost-hermes-intake/tasks.md",
  });
  assertFreshBoundFeatureEvidence({
    workspace,
    ref: requiredMetadataString(metadata, "feature005EvidenceRef"),
    expectedRef: "reports/005-gitlab-automated-validation/evidence.json",
    expectedHash: requiredMetadataString(metadata, "feature005EvidenceHash"),
    expectedFeature: "005-gitlab-automated-validation",
    tasksPath: "specs/005-gitlab-automated-validation/tasks.md",
  });
  assertMattermostCompositionEvidence(
    workspace,
    requiredMetadataString(metadata, "mattermostCompositionEvidenceRef"),
    requiredMetadataString(metadata, "mattermostCompositionEvidenceHash"),
  );

  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...tests, "--maxWorkers=1"],
    { cwd: workspace, env: { ...process.env, CI: "true" }, stdio: "inherit", timeout: 600_000 },
  );
  if (run.error || run.status !== 0) fail("PILOT_REHEARSAL_PROCESS_CHECK_FAILED");
  const evidenceBase = {
    schemaVersion: "gitlab-pilot-gate-evidence@1.0.0",
    gateKind: "PILOT_REHEARSAL",
    status: "PASS",
    metadataRef: relative(workspace, loaded.path).replaceAll("\\", "/"),
    metadataContentHash: loaded.metadata.contentHash,
    contourKey: loaded.metadata.contourKey,
    feature003EvidenceRef: requiredMetadataString(metadata, "feature003EvidenceRef"),
    feature003EvidenceHash: requiredMetadataString(metadata, "feature003EvidenceHash"),
    feature004EvidenceRef: requiredMetadataString(metadata, "feature004EvidenceRef"),
    feature004EvidenceHash: requiredMetadataString(metadata, "feature004EvidenceHash"),
    feature005EvidenceRef: requiredMetadataString(metadata, "feature005EvidenceRef"),
    feature005EvidenceHash: requiredMetadataString(metadata, "feature005EvidenceHash"),
    mattermostCompositionEvidenceRef: requiredMetadataString(
      metadata,
      "mattermostCompositionEvidenceRef",
    ),
    mattermostCompositionEvidenceHash: requiredMetadataString(
      metadata,
      "mattermostCompositionEvidenceHash",
    ),
    mattermostOutageDegradation: "PASS",
    deploymentApproval: "PILOT_REHEARSAL_ONLY",
    productionDenied: true,
    generatedAt: new Date().toISOString(),
  } as const;
  const evidence = Object.freeze({
    ...evidenceBase,
    contentHash: gitLabPilotGateEvidenceHash(evidenceBase),
  });
  validateGitLabPilotGateEvidence(evidence);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(evidence, workspace), "utf8");
  console.log(
    `[pilot-rehearsal:005] PASS; Jira/QA=ACTIVE; delivery=PENDING_RECOVERABLE; approval=PILOT_REHEARSAL_ONLY; report: ${reportPath}`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message.split(":", 1)[0]! : "PILOT_REHEARSAL_FAILED");
}
