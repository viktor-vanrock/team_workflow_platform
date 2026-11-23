import { describe, expect, it } from "vitest";

import {
  assertEvidenceProtectedHeader,
  canonicalEvidenceBytes,
  evidenceContentHash,
} from "../../../packages/competency-qa/src/domain/evidence-manifest-v2.ts";
import { createTargetSnapshotV2 } from "../../../packages/competency-qa/src/domain/snapshots-v2.ts";
import { exactRef, onboardingFixture, projectScope } from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 evidence cryptographic policy", () => {
  it("canonicalizes equal semantic content to identical bytes and SHA-256", () => {
    const first = { z: [3, 2, 1], a: { y: "value", x: true } };
    const second = { a: { x: true, y: "value" }, z: [3, 2, 1] };
    expect(canonicalEvidenceBytes(first)).toBe(canonicalEvidenceBytes(second));
    expect(evidenceContentHash(first)).toBe(
      "sha256:a95c495077e2a8e1c68732090f05d7f5f75d82d5e4291e4c75cfe09d01c82496",
    );
    expect(evidenceContentHash(first)).toBe(evidenceContentHash(second));
  });

  it("pins the complete transitive binding/configuration chain into Target Snapshot v2", () => {
    const bindingRef = exactRef("binding");
    const modeConfiguration = {
      schemaRef: exactRef("mode-schema"),
      value: { mode: "MANUAL" },
      contentHash: evidenceContentHash({ mode: "MANUAL" }),
    };
    const configurationPins = [1, 2].map((ordinal) => ({
      ordinal,
      logicalRole: ordinal === 1 ? "QA_REQUEST_AUTHORITY" : "SOURCE_CONTEXT",
      capabilityKey: ordinal === 1 ? "qa.request" : "source.context",
      exactContractVersion: "1.0.0",
      bindingRef,
      profileRef: exactRef(`profile-${ordinal}`),
      connectionRef: exactRef(`connection-${ordinal}`),
      mappingRef: exactRef(`mapping-${ordinal}`),
      validationReportRef: exactRef(`validation-${ordinal}`),
      operationSetHash: evidenceContentHash([`operation-${ordinal}`]),
      externalScopeHash: evidenceContentHash({ project: onboardingFixture.projectA, ordinal }),
    }));
    const input = {
      snapshotId: "00000000-0000-4000-8000-000000000741",
      ...projectScope(),
      workItemId: "00000000-0000-4000-8000-000000000742",
      sessionId: "00000000-0000-4000-8000-000000000743",
      mode: "MANUAL" as const,
      sourceRefs: [exactRef("source")],
      buildRef: exactRef("build"),
      environmentRef: exactRef("environment"),
      testDataRefs: [exactRef("test-data")],
      accountLeaseRefs: [],
      definitionRefs: [exactRef("definition")],
      configurationPins,
      policyRefs: [exactRef("evidence-policy")],
      modeConfiguration,
      capturedAt: onboardingFixture.now,
    };
    expect(createTargetSnapshotV2(input).configurationPins).toHaveLength(2);
    expect(() =>
      createTargetSnapshotV2({
        ...input,
        configurationPins: [
          configurationPins[0]!,
          { ...configurationPins[1]!, bindingRef: exactRef("other-binding") },
        ],
      }),
    ).toThrow("TARGET_SNAPSHOT_BINDING_PIN_MISMATCH");
  });

  it("accepts only detached EdDSA evidence headers with an exact immutable key version", () => {
    expect(
      assertEvidenceProtectedHeader({
        alg: "EdDSA",
        kid: "local-ed25519:1",
        typ: "application/awp-evidence+json",
      }),
    ).toEqual({ alg: "EdDSA", kid: "local-ed25519:1", typ: "application/awp-evidence+json" });
    for (const alg of ["none", "HS256", "HS512", "RS256"]) {
      expect(() =>
        assertEvidenceProtectedHeader({
          alg,
          kid: "local-ed25519:1",
          typ: "application/awp-evidence+json",
        }),
      ).toThrow("EVIDENCE_JWS_ALGORITHM_FORBIDDEN");
    }
    expect(() =>
      assertEvidenceProtectedHeader({
        alg: "EdDSA",
        kid: "local-ed25519",
        typ: "application/awp-evidence+json",
      }),
    ).toThrow("EVIDENCE_KEY_VERSION_REQUIRED");
  });
});
