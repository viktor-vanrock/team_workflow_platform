import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature007PrerequisiteManifest,
  verifyFeature007PrerequisiteBinding,
} from "../../../tools/verification/feature-007-prerequisites.mts";

const finishedAt = "2026-09-03T12:00:00.000Z";

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-007-prerequisites-"));
}

function digest(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function write(root: string, path: string, value: string): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

function treeDigest(root: string, paths: readonly string[]): `sha256:${string}` {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(`${path}\0${digest(readFileSync(resolve(root, path)))}\n`);
  }
  return `sha256:${hash.digest("hex")}`;
}

function feature006Report(): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      feature: "006-queue-triage-capacity-sla",
      gate: "feature-006-final",
      status: "PASS",
      finishedAt,
      contour: "qa-jira-gitlab-mattermost-local",
      production: "DENIED",
      evidence: {
        path: "reports/006/evidence.json",
        sha256: "sha256:evidence",
        status: "PASS",
      },
      pendingTaskIds: [],
    },
    null,
    2,
  )}\n`;
}

function populate(root: string): Feature007PrerequisiteManifest {
  const reportBytes = feature006Report();
  write(root, "reports/006/final-gate.json", reportBytes);
  const compatibilityPaths = ["contracts/binding-v1.json", "contracts/evidence-v1.json"];
  write(
    root,
    compatibilityPaths[0]!,
    "ProjectIntegrationBinding configurationRefs resourceRefs PUBLISHED\n",
  );
  write(root, compatibilityPaths[1]!, "TargetSnapshot EvidenceManifest LEGACY_INTEGRITY_ONLY\n");
  const migrationPaths = [
    "migrations/core-0140.ts",
    "migrations/qa-2070.ts",
    "migrations/registry.ts",
  ];
  for (const path of migrationPaths) write(root, path, `${path}: immutable\n`);
  return {
    schemaVersion: 1,
    maximumReportAgeMs: 86_400_000,
    upstreamReport: {
      id: "feature-006",
      path: "reports/006/final-gate.json",
      sha256: digest(reportBytes),
      schemaVersion: 1,
      feature: "006-queue-triage-capacity-sla",
      gate: "feature-006-final",
    },
    compatibilitySnapshot: {
      paths: compatibilityPaths,
      sha256: treeDigest(root, compatibilityPaths),
      requiredTokens: [
        "ProjectIntegrationBinding",
        "configurationRefs",
        "resourceRefs",
        "TargetSnapshot",
        "EvidenceManifest",
      ],
    },
    migrationSnapshot: {
      paths: migrationPaths,
      sha256: treeDigest(root, migrationPaths),
    },
  };
}

describe("Feature 007 fail-closed prerequisite gate", () => {
  it("accepts a fresh source-bound Feature 006 PASS and exact compatibility/migration baselines", () => {
    const root = fixture();
    const result = verifyFeature007PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result).toMatchObject({ status: "PASS" });
    expect(result.upstreamReport.code).toBe("FEATURE_006_REPORT_ACCEPTED");
    expect(result.compatibilitySnapshot.code).toBe("FEATURE_001_006_COMPATIBILITY_ACCEPTED");
    expect(result.migrationSnapshot.code).toBe("PUBLISHED_MIGRATIONS_ACCEPTED");
  });

  it("rejects a missing or stale Feature 006 report", () => {
    const missingRoot = fixture();
    const originalMissing = populate(missingRoot);
    const missing: Feature007PrerequisiteManifest = {
      ...originalMissing,
      upstreamReport: { ...originalMissing.upstreamReport, path: "reports/006/missing.json" },
    };
    expect(
      verifyFeature007PrerequisiteBinding(missingRoot, missing, Date.parse(finishedAt), () => [])
        .upstreamReport.code,
    ).toBe("FEATURE_006_REPORT_MISSING");

    const staleRoot = fixture();
    const stale = populate(staleRoot);
    expect(
      verifyFeature007PrerequisiteBinding(
        staleRoot,
        stale,
        Date.parse(finishedAt) + 86_400_001,
        () => [],
      ).upstreamReport.code,
    ).toBe("FEATURE_006_REPORT_STALE");
  });

  it("rejects copied or byte-drifted final evidence", () => {
    const root = fixture();
    const manifest = populate(root);
    write(root, manifest.upstreamReport.path, `${feature006Report()} `);

    const result = verifyFeature007PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.upstreamReport.code).toBe("FEATURE_006_REPORT_DIGEST_MISMATCH");
    expect(result.status).toBe("FAIL");
  });

  it("rejects source, contract, task, runtime or migration binding failures from the Feature 006 evidence probe", () => {
    const root = fixture();
    const result = verifyFeature007PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 60_000,
      () => ["SOURCE_SNAPSHOT_MISMATCH", "TASKS_PENDING", "RUNTIME_SNAPSHOT_MISMATCH"],
    );

    expect(result.upstreamReport.code).toBe("FEATURE_006_SOURCE_BINDING_MISMATCH");
    expect(result.status).toBe("FAIL");
  });

  it("rejects consumed Feature 001–006 contract drift", () => {
    const root = fixture();
    const manifest = populate(root);
    write(root, manifest.compatibilitySnapshot.paths[0]!, "ProjectIntegrationBinding changed\n");

    const result = verifyFeature007PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.compatibilitySnapshot.code).toBe("FEATURE_001_006_COMPATIBILITY_DIGEST_MISMATCH");
    expect(result.status).toBe("FAIL");
  });

  it("rejects published Core/QA migration drift", () => {
    const root = fixture();
    const manifest = populate(root);
    write(root, manifest.migrationSnapshot.paths[1]!, "mutated migration\n");

    const result = verifyFeature007PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.migrationSnapshot.code).toBe("PUBLISHED_MIGRATIONS_DIGEST_MISMATCH");
    expect(result.status).toBe("FAIL");
  });

  it("rejects a hash-updated compatibility baseline that drops required semantics", () => {
    const root = fixture();
    const original = populate(root);
    write(root, original.compatibilitySnapshot.paths[1]!, "LEGACY_INTEGRITY_ONLY\n");
    const manifest: Feature007PrerequisiteManifest = {
      ...original,
      compatibilitySnapshot: {
        ...original.compatibilitySnapshot,
        sha256: treeDigest(root, original.compatibilitySnapshot.paths),
      },
    };

    const result = verifyFeature007PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.compatibilitySnapshot.code).toBe("FEATURE_001_006_COMPATIBILITY_INVALID");
    expect(result.status).toBe("FAIL");
  });
});
