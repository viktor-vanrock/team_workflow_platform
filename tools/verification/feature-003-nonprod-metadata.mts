import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  type ContentReference,
  type PilotMetadata,
  validatePilotMetadata,
} from "./feature-003-nonprod-metadata-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(
  workspace,
  "reports/003-jira-operational-authority/nonprod-metadata.json",
);
const suppliedPath = process.env.AWP_JIRA_NONPROD_METADATA_PACKAGE?.trim();

type Status = "PASS" | "FAIL" | "SKIPPED_GATED";

function writeReport(report: Readonly<Record<string, unknown>>): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.log(`[nonprod-metadata:003] ${String(report.status)}; report: ${reportPath}`);
}

function evidence(reference: ContentReference): Readonly<Record<string, unknown>> {
  return Object.freeze({
    idHash: createHash("sha256").update(reference.id).digest("hex"),
    version: reference.version,
    contentHash: reference.contentHash,
  });
}

function metadataPath(input: string): string {
  const path = isAbsolute(input) ? resolve(input) : resolve(workspace, input);
  if (!isAbsolute(input) && path !== workspace && !path.startsWith(`${workspace}/`))
    throw new Error("C1_PATH_OUTSIDE_WORKSPACE");
  return path;
}

function assertNonProd(candidate: PilotMetadata): URL {
  if (candidate.environment !== "NON_PROD") throw new Error("C1_ENVIRONMENT_NOT_NON_PROD");
  if (candidate.auth.kind === "LOCAL_FAKE") throw new Error("C1_LOCAL_AUTH_FORBIDDEN");
  if (candidate.adapter.exactBuild.trim().length === 0) throw new Error("C1_EXACT_BUILD_MISSING");
  const endpoint = new URL(candidate.endpoint.baseUrl);
  if (endpoint.protocol !== "https:") throw new Error("C1_TLS_REQUIRED");
  if (candidate.webhook.dedupeHorizonSeconds < candidate.webhook.retryHorizonSeconds)
    throw new Error("C1_WEBHOOK_DEDUPE_TOO_SHORT");
  if (
    candidate.rateBudget.maxInFlight < 1 ||
    candidate.reconciliation.maxConcurrency > candidate.rateBudget.maxInFlight
  )
    throw new Error("C1_CONCURRENCY_EXCEEDS_RATE_BUDGET");
  if (
    candidate.concurrency.mode === "COMPARE_AND_VERIFY" &&
    !candidate.concurrency.riskAcceptanceRef
  )
    throw new Error("C1_CONCURRENCY_RISK_ACCEPTANCE_MISSING");
  if (
    candidate.concurrency.mode === "JIRA_SIDE_CAS" &&
    !candidate.concurrency.conditionalMutationCapabilityRef
  )
    throw new Error("C1_CAS_CAPABILITY_MISSING");
  return endpoint;
}

const startedAt = new Date();
if (!suppliedPath) {
  writeReport({
    schemaVersion: 1,
    feature: "003-jira-operational-authority",
    gate: "nonprod-metadata",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status: "SKIPPED_GATED" satisfies Status,
    reasonCode: "C1_METADATA_NOT_SUPPLIED",
  });
  process.exit(0);
}

let status: Status = "PASS";
let reasonCode: string | undefined;
let detail: string | undefined;
let sanitizedMetadata: Readonly<Record<string, unknown>> | undefined;
try {
  const path = metadataPath(suppliedPath);
  if (!existsSync(path)) throw new Error("C1_METADATA_MISSING");
  const metadata = validatePilotMetadata(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
    workspace,
  );
  const endpoint = assertNonProd(metadata);
  sanitizedMetadata = Object.freeze({
    packageIdHash: createHash("sha256").update(metadata.packageId).digest("hex"),
    version: metadata.version,
    contentHash: metadata.contentHash,
    environment: metadata.environment,
    adapter: {
      edition: metadata.adapter.edition,
      family: metadata.adapter.family,
      contractVersion: metadata.adapter.contractVersion,
      exactBuild: metadata.adapter.exactBuild,
      apiFlavor: metadata.adapter.apiFlavor,
    },
    endpoint: {
      scheme: endpoint.protocol,
      hostHash: createHash("sha256").update(endpoint.hostname).digest("hex"),
      tenantKeyHash: createHash("sha256").update(metadata.endpoint.tenantKey).digest("hex"),
    },
    evidence: {
      capability: evidence(metadata.adapter.capabilityEvidenceRef),
      tls: evidence(metadata.endpoint.tlsPolicyRef),
      permissions: evidence(metadata.auth.leastPrivilegeEvidenceRef),
      rotation: evidence(metadata.auth.rotationPolicyRef),
      revocation: evidence(metadata.auth.revocationRunbookRef),
      webhook: evidence(metadata.webhook.evidenceRef),
      concurrency: evidence(metadata.concurrency.safetyEvidenceRef),
      networkAllowlist: evidence(metadata.networkEvidenceRef),
    },
    webhook: {
      registrationKind: metadata.webhook.registrationKind,
      verificationMode: metadata.webhook.verificationMode,
      retryHorizonSeconds: metadata.webhook.retryHorizonSeconds,
      dedupeHorizonSeconds: metadata.webhook.dedupeHorizonSeconds,
    },
    rateBudget: metadata.rateBudget,
    reconciliation: metadata.reconciliation,
    concurrencyMode: metadata.concurrency.mode,
  });
} catch (error) {
  status = "FAIL";
  reasonCode =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "C1_METADATA_INVALID";
  detail =
    error instanceof Error
      ? error.message.replaceAll(suppliedPath, "<metadata-package>")
      : String(error);
}

writeReport({
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "nonprod-metadata",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  ...(reasonCode ? { reasonCode, detail } : {}),
  ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
});
if (status === "FAIL") process.exitCode = 1;
