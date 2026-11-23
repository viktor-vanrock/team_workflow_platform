import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature006PrerequisiteManifest,
  verifyFeature006PrerequisiteBinding,
} from "../../../tools/verification/feature-006-prerequisites.mts";

const finishedAt = "2026-09-02T08:00:00.000Z";

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-006-prerequisites-"));
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

function report(feature: string, gate: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      feature,
      gate,
      status: "PASS",
      finishedAt,
      handoff: {
        status: "BOUND",
        generatedAfterAllProcessGates: true,
        taskSnapshot: { taskCount: 2, completedTaskIds: ["T001", "T002"], pendingTaskIds: [] },
        sourceSnapshot: { sha256: "sha256:source" },
        contractSnapshot: { sha256: "sha256:contracts" },
        runtimeSnapshot: { sha256: "sha256:runtime" },
      },
    },
    null,
    2,
  )}\n`;
}

function populate(root: string): Feature006PrerequisiteManifest {
  const reportInputs = [
    [
      "feature-003",
      "reports/003/final-gate.json",
      "003-jira-operational-authority",
      "feature-003-final",
    ],
    [
      "feature-004",
      "reports/004/final-gate.json",
      "004-mattermost-hermes-intake",
      "feature-004-final",
    ],
    [
      "feature-005",
      "reports/005/final-gate.json",
      "005-gitlab-automated-validation",
      "feature-005-final",
    ],
  ] as const;
  const upstreamReports = reportInputs.map(([id, path, feature, gate]) => {
    const bytes = report(feature, gate);
    write(root, path, bytes);
    return { id, path, sha256: digest(bytes), schemaVersion: 1, feature, gate };
  });
  const compatibilityPaths = ["contracts/feature-002-005-baseline.txt"];
  write(
    root,
    compatibilityPaths[0]!,
    "CANDIDATE DRAFT TriageAssessment MANUAL REVIEW_REQUIRED qa.validation@1.2.0\n",
  );
  const migrationPaths = [
    "migrations/core-0120.ts",
    "migrations/qa-2060.ts",
    "migrations/registry.ts",
  ];
  for (const path of migrationPaths) write(root, path, `${path}: immutable\n`);
  return {
    schemaVersion: 1,
    maximumReportAgeMs: 86_400_000,
    upstreamReports,
    compatibilitySnapshot: {
      paths: compatibilityPaths,
      sha256: treeDigest(root, compatibilityPaths),
    },
    migrationSnapshot: { paths: migrationPaths, sha256: treeDigest(root, migrationPaths) },
  };
}

describe("Feature 006 fail-closed prerequisite gate", () => {
  it("accepts fresh source-bound Features 003–005 evidence and exact Feature 002–005 baselines", () => {
    const root = fixture();
    const result = verifyFeature006PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.status).toBe("PASS");
    expect(result.upstreamReports.every(({ status }) => status === "PASS")).toBe(true);
    expect(result.compatibilitySnapshot.code).toBe("FEATURE_002_005_COMPATIBILITY_ACCEPTED");
    expect(result.migrationSnapshot.code).toBe("PUBLISHED_MIGRATIONS_ACCEPTED");
  });

  it("rejects a missing upstream report", () => {
    const root = fixture();
    const manifest = populate(root);
    manifest.upstreamReports[0] = {
      ...manifest.upstreamReports[0]!,
      path: "reports/003/missing.json",
    };

    const result = verifyFeature006PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.status).toBe("FAIL");
    expect(result.upstreamReports[0]?.code).toBe("UPSTREAM_REPORT_MISSING");
  });

  it("rejects stale upstream evidence", () => {
    const root = fixture();
    const result = verifyFeature006PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 86_400_001,
      () => [],
    );

    expect(result.status).toBe("FAIL");
    expect(result.upstreamReports[0]?.code).toBe("UPSTREAM_REPORT_STALE");
  });

  it("rejects report bytes and current source/runtime binding drift independently", () => {
    const root = fixture();
    const manifest = populate(root);
    write(
      root,
      manifest.upstreamReports[0]!.path,
      `${report("003-jira-operational-authority", "feature-003-final")} `,
    );

    const result = verifyFeature006PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      (id) =>
        id === "feature-004" ? ["SOURCE_SNAPSHOT_MISMATCH", "RUNTIME_SNAPSHOT_MISMATCH"] : [],
    );

    expect(result.upstreamReports[0]?.code).toBe("UPSTREAM_REPORT_DIGEST_MISMATCH");
    expect(result.upstreamReports[1]?.code).toBe("UPSTREAM_SOURCE_BINDING_MISMATCH");
  });

  it("rejects consumed Feature 002–005 contract drift", () => {
    const root = fixture();
    const manifest = populate(root);
    write(root, manifest.compatibilitySnapshot.paths[0]!, "CANDIDATE DRAFT changed\n");

    const result = verifyFeature006PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.compatibilitySnapshot.code).toBe("FEATURE_002_005_COMPATIBILITY_DIGEST_MISMATCH");
    expect(result.status).toBe("FAIL");
  });

  it("rejects published Core/QA migration drift", () => {
    const root = fixture();
    const manifest = populate(root);
    write(root, manifest.migrationSnapshot.paths[1]!, "mutated migration\n");

    const result = verifyFeature006PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.migrationSnapshot.code).toBe("PUBLISHED_MIGRATIONS_DIGEST_MISMATCH");
    expect(result.status).toBe("FAIL");
  });

  it("rejects a hash-updated baseline that widens Feature 002–005 semantics", () => {
    const root = fixture();
    const manifest = populate(root);
    write(
      root,
      manifest.compatibilitySnapshot.paths[0]!,
      "CANDIDATE DRAFT TriageAssessment MANUAL qa.validation@1.2.0\n",
    );
    manifest.compatibilitySnapshot = {
      ...manifest.compatibilitySnapshot,
      sha256: treeDigest(root, manifest.compatibilitySnapshot.paths),
    };

    const result = verifyFeature006PrerequisiteBinding(
      root,
      manifest,
      Date.parse(finishedAt) + 60_000,
      () => [],
    );

    expect(result.compatibilitySnapshot.code).toBe("FEATURE_002_005_COMPATIBILITY_INVALID");
    expect(result.status).toBe("FAIL");
  });
});
