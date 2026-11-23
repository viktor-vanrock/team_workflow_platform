import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FEATURE_008, hashBytes } from "../../../tools/verification/feature-008-prerequisites.mts";
import {
  aggregateGateReports008,
  type GateReport008,
  readGateReport008,
  validateGateReport008,
  writeGateReport008,
} from "../../../tools/verification/feature-008-reports.mts";

const dirs: string[] = [];
const stamp = "2026-09-03T12:00:00.000Z";
const now = Date.parse(stamp) + 1000;
const sha = hashBytes("fixture");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awp-008-reports-"));
  dirs.push(root);
  const path = `reports/${FEATURE_008}/fixture-result.json`;
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), "{}\n");
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId: "fixture-run",
    gate: "setup",
    status: "PASS",
    deploymentProfile: "local",
    scope: { workspaceId: "w", projectIds: ["p"] },
    startedAt: stamp,
    finishedAt: stamp,
    fingerprints: {
      source: sha,
      contracts: sha,
      migrations: sha,
      lockfile: sha,
      configuration: sha,
      inputs: sha,
      suite: sha,
    },
    executorIdentity: "local-test",
    checks: [
      {
        id: "assertion",
        status: "PASS",
        evidence: [{ path, sha256: hashBytes("{}\n") }],
        reasonCodes: [],
      },
    ],
    prerequisites: [],
    reasonCodes: [],
  };
  return {
    root,
    report,
    options: {
      now,
      maximumAgeMs: 60_000,
      scope: report.scope,
      fingerprints: report.fingerprints,
      allowedExecutors: ["local-test"],
    },
  };
}
afterEach(() => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
describe("008 immutable, source-bound gate evidence", () => {
  it("accepts a fresh matching report and immutable idempotent write", () => {
    const { root, report, options } = fixture();
    expect(validateGateReport008(report, options)).toEqual([]);
    const ref = writeGateReport008(root, report, options);
    expect(writeGateReport008(root, report, options)).toEqual(ref);
    expect(readGateReport008(root, ref, options).status).toBe("PASS");
  });
  it("cannot overwrite the same run with changed data", () => {
    const { root, report, options } = fixture();
    writeGateReport008(root, report, options);
    expect(() => writeGateReport008(root, { ...report, gate: "foundation" }, options)).toThrow(
      /IMMUTABLE/,
    );
  });
  it("rejects a skipped child disguised as PASS", () => {
    const { report, options } = fixture();
    const errors = validateGateReport008(
      { ...report, checks: [{ ...report.checks[0]!, status: "SKIPPED_GATED" }] },
      options,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
  it("rejects missing evidence and unknown fields", () => {
    const { report, options } = fixture();
    expect(
      validateGateReport008(
        { ...report, checks: [{ ...report.checks[0]!, evidence: [] }] },
        options,
      ).length,
    ).toBeGreaterThan(0);
    expect(validateGateReport008({ ...report, privateKey: "leak" }, options)).toContain(
      "REPORT_SENSITIVE_DATA",
    );
  });
  it("revalidates referenced bytes on every read", () => {
    const { root, report, options } = fixture();
    const ref = writeGateReport008(root, report, options);
    writeFileSync(join(root, report.checks[0]!.evidence[0]!.path), "tampered");
    expect(() => readGateReport008(root, ref, options)).toThrow(/EVIDENCE_DIGEST/);
  });
  it("rejects report byte tampering", () => {
    const { root, report, options } = fixture();
    const ref = writeGateReport008(root, report, options);
    writeFileSync(join(root, ref.path), readFileSync(join(root, ref.path), "utf8") + " ");
    expect(() => readGateReport008(root, ref, options)).toThrow(/REPORT_DIGEST/);
  });
  it("rejects scope, source fingerprint and executor substitution", () => {
    const { report, options } = fixture();
    expect(
      validateGateReport008(
        { ...report, scope: { workspaceId: "other", projectIds: ["p"] } },
        options,
      ),
    ).toContain("REPORT_SCOPE_MISMATCH");
    expect(
      validateGateReport008(
        { ...report, fingerprints: { ...report.fingerprints, source: hashBytes("different") } },
        options,
      ),
    ).toContain("REPORT_FINGERPRINT_MISMATCH:source");
    expect(validateGateReport008({ ...report, executorIdentity: "untrusted" }, options)).toContain(
      "REPORT_EXECUTOR_UNTRUSTED",
    );
  });
  it("rejects stale, reversed and invalid timestamps", () => {
    const { report, options } = fixture();
    expect(validateGateReport008(report, { ...options, now: now + 61_000 })).toContain(
      "REPORT_STALE",
    );
    expect(
      validateGateReport008({ ...report, startedAt: "2026-09-03T13:00:00.000Z" }, options),
    ).toContain("REPORT_TIME_INVALID");
    expect(
      validateGateReport008({ ...report, finishedAt: "2026-02-30T12:00:00.000Z" }, options),
    ).toContain("REPORT_TIME_INVALID");
  });
  it("rejects path traversal and symlink evidence", () => {
    const { root, report, options } = fixture();
    expect(() =>
      writeGateReport008(
        root,
        {
          ...report,
          checks: [{ ...report.checks[0]!, evidence: [{ path: "../escape", sha256: sha }] }],
        },
        options,
      ),
    ).toThrow(/PATH/);
    const p = report.checks[0]!.evidence[0]!.path;
    rmSync(join(root, p));
    symlinkSync(join(root, "absent"), join(root, p));
    expect(() => writeGateReport008(root, report, options)).toThrow();
  });
  it("does not aggregate missing, skipped or failed prerequisites into PASS", () => {
    const { root, report, options } = fixture();
    const ref = writeGateReport008(root, report, options);
    expect(aggregateGateReports008(root, [ref], options).status).toBe("PASS");
    const blocked = {
      ...report,
      runId: "blocked",
      status: "BLOCKED_INPUT" as const,
      reasonCodes: ["INPUT_REQUIRED"],
      checks: [
        {
          id: "input",
          status: "BLOCKED_INPUT" as const,
          evidence: [],
          reasonCodes: ["INPUT_REQUIRED"],
        },
      ],
    };
    const blockedRef = writeGateReport008(root, blocked, options);
    expect(aggregateGateReports008(root, [ref, blockedRef], options).status).toBe("BLOCKED_INPUT");
    expect(aggregateGateReports008(root, [], options).status).toBe("FAIL");
    expect(
      aggregateGateReports008(
        root,
        [{ path: `reports/${FEATURE_008}/missing.json`, sha256: sha }],
        options,
      ).status,
    ).toBe("FAIL");
  });
  it("corporate security reports require release and scanner fingerprints", () => {
    const { report, options } = fixture();
    expect(
      validateGateReport008({ ...report, deploymentProfile: "pilot", gate: "security" }, options),
    ).toContain("REPORT_RELEASE_SCAN_BINDING_REQUIRED");
  });
});
