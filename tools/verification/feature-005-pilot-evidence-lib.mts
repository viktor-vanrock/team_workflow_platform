import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { type JsonValue, sha256 } from "../../packages/platform-contracts/src/canonical-hash.ts";
import { designContractRegistry } from "../../packages/platform-contracts/src/schema-registry.ts";

export type JsonRecord = Readonly<Record<string, unknown>>;
const maximumEvidenceAgeMs = 7 * 24 * 60 * 60_000;

export function sha256File(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPilotJson(path: string): JsonRecord {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size > 5_000_000)
    throw new Error(`PILOT_EVIDENCE_SIZE_INVALID:${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8"), (key, value: unknown) => {
    if (new Set(["__proto__", "constructor", "prototype"]).has(key))
      throw new Error(`PILOT_EVIDENCE_DANGEROUS_KEY:${key}`);
    return value;
  }) as unknown;
  if (!isJsonRecord(parsed)) throw new Error(`PILOT_EVIDENCE_NOT_OBJECT:${path}`);
  return parsed;
}

export function resolvePilotEvidence(
  workspace: string,
  ref: string,
  exactExpectedRef: string,
  expectedHash: string,
): Readonly<{ path: string; report: JsonRecord; sha256: string }> {
  if (ref !== exactExpectedRef) throw new Error(`PILOT_EVIDENCE_REF_INVALID:${ref}`);
  const path = resolve(workspace, ref);
  if (!path.startsWith(`${workspace}/`) || !existsSync(path))
    throw new Error(`PILOT_EVIDENCE_MISSING:${ref}`);
  const actualHash = sha256File(path);
  if (actualHash !== expectedHash) throw new Error(`PILOT_EVIDENCE_HASH_MISMATCH:${ref}`);
  return Object.freeze({ path, report: readPilotJson(path), sha256: actualHash });
}

export function assertFreshBoundFeatureEvidence(
  input: Readonly<{
    workspace: string;
    ref: string;
    expectedRef: string;
    expectedHash: string;
    expectedFeature: string;
    tasksPath: string;
  }>,
): JsonRecord {
  const resolved = resolvePilotEvidence(
    input.workspace,
    input.ref,
    input.expectedRef,
    input.expectedHash,
  );
  if (resolved.report.status !== "PASS" || resolved.report.feature !== input.expectedFeature)
    throw new Error(`PILOT_FEATURE_EVIDENCE_INVALID:${input.ref}`);
  const timestamp = [
    resolved.report.finishedAt,
    resolved.report.generatedAt,
    resolved.report.startedAt,
  ].find((value) => typeof value === "string");
  const time = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  if (
    !Number.isFinite(time) ||
    Date.now() - time > maximumEvidenceAgeMs ||
    time > Date.now() + 300_000
  )
    throw new Error(`PILOT_FEATURE_EVIDENCE_STALE:${input.ref}`);
  const taskHash = sha256File(resolve(input.workspace, input.tasksPath));
  const handoff = isJsonRecord(resolved.report.handoff) ? resolved.report.handoff : undefined;
  const snapshots = isJsonRecord(resolved.report.snapshots) ? resolved.report.snapshots : undefined;
  const snapshot =
    handoff && isJsonRecord(handoff.taskSnapshot)
      ? handoff.taskSnapshot
      : snapshots && isJsonRecord(snapshots.taskSnapshot)
        ? snapshots.taskSnapshot
        : undefined;
  if (!snapshot || snapshot.sha256 !== taskHash)
    throw new Error(`PILOT_FEATURE_TASK_BINDING_INVALID:${input.ref}`);
  return resolved.report;
}

export function assertMattermostCompositionEvidence(
  workspace: string,
  ref: string,
  expectedHash: string,
): JsonRecord {
  const resolved = resolvePilotEvidence(
    workspace,
    ref,
    "reports/004-mattermost-hermes-intake/smoke.json",
    expectedHash,
  );
  const stages = Array.isArray(resolved.report.stages)
    ? resolved.report.stages.filter(isJsonRecord)
    : [];
  if (
    resolved.report.status !== "PASS" ||
    resolved.report.composition !== "qa-jira-mattermost-local" ||
    !stages.some((stage) => stage.id === "us4-notifications" && stage.status === "PASS")
  ) {
    throw new Error("PILOT_MATTERMOST_OUTAGE_EVIDENCE_INVALID");
  }
  return resolved.report;
}

export function gitLabPilotGateEvidenceHash(value: JsonRecord): `sha256:${string}` {
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy.contentHash;
  return sha256(copy as JsonValue);
}

export function validateGitLabPilotGateEvidence(value: JsonRecord): JsonRecord {
  const candidate = structuredClone(value) as Record<string, unknown>;
  const actualHash = gitLabPilotGateEvidenceHash(candidate);
  if (candidate.contentHash !== actualHash)
    throw new Error(`PILOT_GATE_CONTENT_HASH_MISMATCH:${actualHash}`);
  return designContractRegistry.validateById(
    "urn:awp:schemas:005:gitlab-pilot-gate-evidence:v1",
    candidate,
  ) as JsonRecord;
}

export function requiredMetadataString(metadata: JsonRecord, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`PILOT_METADATA_REFERENCE_MISSING:${key}`);
  return value;
}
