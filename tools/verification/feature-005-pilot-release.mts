import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  assertFeature005PilotRelease,
  readFeature005Metadata,
} from "./feature-005-nonprod-metadata-lib.mts";
import {
  assertFreshBoundFeatureEvidence,
  assertMattermostCompositionEvidence,
  gitLabPilotGateEvidenceHash,
  readPilotJson,
  requiredMetadataString,
  resolvePilotEvidence,
  validateGitLabPilotGateEvidence,
} from "./feature-005-pilot-evidence-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/pilot-release.json");
const args = process.argv.slice(2).filter((value) => value !== "--");
const planOnly = args.includes("--plan");
const metadataIndex = args.indexOf("--metadata");
const metadataArgument =
  metadataIndex >= 0
    ? args[metadataIndex + 1]
    : process.env.AWP_GITLAB_PILOT_RELEASE_METADATA?.trim();
const unexpected = args.filter(
  (value, index) => value !== "--metadata" && value !== "--plan" && index !== metadataIndex + 1,
);
if (unexpected.length > 0)
  throw new Error(`Unknown verify:005:pilot-release arguments: ${unexpected.join(", ")}`);
if (planOnly) {
  console.log(
    "metadata purpose=PILOT_DEPLOYMENT; contour=qa-jira-gitlab-mattermost-development|test; HTTPS required",
  );
  console.log(
    "fresh bound Feature 003/004/005 + Mattermost outage PASS + exact PILOT_REHEARSAL receipt/hash",
  );
  console.log(
    "deploymentApproval=PILOT_APPROVED; production=DENIED; no deployment call is performed",
  );
  process.exit(0);
}

const startedAt = new Date();
function fail(reasonCode: string): never {
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "005-gitlab-automated-validation",
    gate: "pilot-release",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status: "FAIL",
    reasonCode,
    deploymentApproval: "DENIED",
    production: "DENIED",
    deploymentCalls: 0,
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.error(`[pilot-release:005] FAIL; reason=${reasonCode}; report: ${reportPath}`);
  process.exit(1);
}
if (!metadataArgument) fail("PILOT_RELEASE_METADATA_REQUIRED");

try {
  const loaded = readFeature005Metadata(metadataArgument, workspace);
  assertFeature005PilotRelease(loaded.metadata);
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

  const rehearsal = resolvePilotEvidence(
    workspace,
    requiredMetadataString(metadata, "pilotRehearsalEvidenceRef"),
    "reports/005-gitlab-automated-validation/pilot-rehearsal.json",
    requiredMetadataString(metadata, "pilotRehearsalEvidenceHash"),
  );
  const rehearsalEvidence = validateGitLabPilotGateEvidence(readPilotJson(rehearsal.path));
  if (
    rehearsalEvidence.gateKind !== "PILOT_REHEARSAL" ||
    rehearsalEvidence.status !== "PASS" ||
    rehearsalEvidence.deploymentApproval !== "PILOT_REHEARSAL_ONLY" ||
    rehearsalEvidence.mattermostOutageDegradation !== "PASS"
  )
    throw new Error("PILOT_REHEARSAL_RECEIPT_INVALID");
  for (const key of [
    "feature003EvidenceRef",
    "feature003EvidenceHash",
    "feature004EvidenceRef",
    "feature004EvidenceHash",
    "feature005EvidenceRef",
    "feature005EvidenceHash",
    "mattermostCompositionEvidenceRef",
    "mattermostCompositionEvidenceHash",
  ] as const) {
    if (rehearsalEvidence[key] !== metadata[key])
      throw new Error(`PILOT_REHEARSAL_BINDING_MISMATCH:${key}`);
  }
  const metadataGeneratedAt = Date.parse(loaded.metadata.generatedAt);
  const rehearsalGeneratedAt = Date.parse(String(rehearsalEvidence.generatedAt));
  if (!Number.isFinite(metadataGeneratedAt) || metadataGeneratedAt < rehearsalGeneratedAt)
    throw new Error("PILOT_RELEASE_METADATA_PREDATES_REHEARSAL");

  const evidenceBase = {
    schemaVersion: "gitlab-pilot-gate-evidence@1.0.0",
    gateKind: "PILOT_RELEASE",
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
    pilotRehearsalEvidenceRef: requiredMetadataString(metadata, "pilotRehearsalEvidenceRef"),
    pilotRehearsalEvidenceHash: requiredMetadataString(metadata, "pilotRehearsalEvidenceHash"),
    mattermostOutageDegradation: "PASS",
    deploymentApproval: "PILOT_APPROVED",
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
    `[pilot-release:005] PASS; approval=PILOT_APPROVED; production=DENIED; deploymentCalls=0; report: ${reportPath}`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message.split(":", 1)[0]! : "PILOT_RELEASE_FAILED");
}
