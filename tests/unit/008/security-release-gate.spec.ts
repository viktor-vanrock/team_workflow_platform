import { describe, expect, it } from "vitest";

import { evaluateReleaseSecurity008 } from "../../../tools/verification/feature-008-security.mts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const now = Date.parse("2026-09-05T00:00:00Z"),
  image = digest("a"),
  databaseDigest = digest("b"),
  policyDigest = digest("c");
const bundle = () => ({
  schemaVersion: "release-security@1.0.0",
  scanner: { id: "scanner", version: "1.0.0" },
  database: {
    id: "db",
    version: "2026.09.04",
    digest: databaseDigest,
    publishedAt: "2026-09-04T00:00:00Z",
  },
  policy: {
    id: "policy",
    version: "1.0.0",
    digest: policyDigest,
    reportMaximumAgeMs: 172_800_000,
    databaseMaximumAgeMs: 172_800_000,
    acceptedRiskSeverities: ["MODERATE", "LOW"],
    acceptedFindings: [],
  },
  report: {
    schemaVersion: "security-scan@1.0.0",
    kind: "IMAGE",
    contour: "CORPORATE",
    coverage: "FULL",
    artifact: { kind: "OCI_IMAGE", digest: image },
    scanner: { id: "scanner", version: "1.0.0" },
    database: {
      id: "db",
      version: "2026.09.04",
      digest: databaseDigest,
      publishedAt: "2026-09-04T00:00:00Z",
    },
    policy: { id: "policy", version: "1.0.0", digest: policyDigest },
    scannedAt: "2026-09-05T00:00:00Z",
    findings: [],
  },
});

describe("008 release image security gate", () => {
  it("blocks when the independently supplied release digest is absent", () =>
    expect(evaluateReleaseSecurity008(bundle(), null, now)).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: ["RELEASE_IMAGE_DIGEST_MISSING"],
    }));
  it("blocks malformed corporate evidence", () =>
    expect(evaluateReleaseSecurity008({ report: {} }, image, now)).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: ["RELEASE_SCAN_BUNDLE_INVALID"],
    }));
  it("blocks a self-reported digest that differs from the actual release artifact", () =>
    expect(evaluateReleaseSecurity008(bundle(), digest("d"), now)).toMatchObject({
      status: "BLOCKED_INPUT",
      releaseEligible: false,
      reasonCodes: expect.arrayContaining(["SCAN_ARTIFACT_MISMATCH"]),
    }));
  it("blocks stale scan and database evidence", () => {
    const value = bundle();
    value.report.scannedAt = "2026-09-01T00:00:00Z";
    value.report.database.publishedAt = "2026-09-01T00:00:00Z";
    value.database.publishedAt = "2026-09-01T00:00:00Z";
    expect(evaluateReleaseSecurity008(value, image, now)).toMatchObject({
      status: "BLOCKED_INPUT",
      releaseEligible: false,
      reasonCodes: expect.arrayContaining(["SCAN_REPORT_STALE", "SCAN_DATABASE_STALE"]),
    });
  });
  it("allows only an exact fresh full corporate image scan", () =>
    expect(evaluateReleaseSecurity008(bundle(), image, now)).toMatchObject({
      status: "PASS",
      releaseEligible: true,
      imageDigest: image,
      scannerDatabase: databaseDigest,
    }));
});
