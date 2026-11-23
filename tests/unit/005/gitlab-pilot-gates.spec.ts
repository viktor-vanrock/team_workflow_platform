import { describe, expect, it } from "vitest";

import {
  gitLabPilotGateEvidenceHash,
  validateGitLabPilotGateEvidence,
} from "../../../tools/verification/feature-005-pilot-evidence-lib.mts";

const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const common = Object.freeze({
  schemaVersion: "gitlab-pilot-gate-evidence@1.0.0",
  status: "PASS",
  metadataRef: "config/gitlab-pilot-metadata.json",
  metadataContentHash: hash("1"),
  feature003EvidenceRef: "reports/003-jira-operational-authority/final-gate.json",
  feature003EvidenceHash: hash("3"),
  feature004EvidenceRef: "reports/004-mattermost-hermes-intake/final-gate.json",
  feature004EvidenceHash: hash("4"),
  feature005EvidenceRef: "reports/005-gitlab-automated-validation/evidence.json",
  feature005EvidenceHash: hash("5"),
  mattermostCompositionEvidenceRef: "reports/004-mattermost-hermes-intake/smoke.json",
  mattermostCompositionEvidenceHash: hash("6"),
  mattermostOutageDegradation: "PASS",
  productionDenied: true,
  generatedAt: "2026-09-02T00:00:00.000Z",
} as const);

function withHash<T extends Readonly<Record<string, unknown>>>(
  value: T,
): T & Readonly<{ contentHash: `sha256:${string}` }> {
  return Object.freeze({ ...value, contentHash: gitLabPilotGateEvidenceHash(value) });
}

describe("Feature 005 pilot rehearsal/release evidence", () => {
  it("admits only local rehearsal authority", () => {
    const evidence = withHash({
      ...common,
      gateKind: "PILOT_REHEARSAL",
      contourKey: "qa-jira-gitlab-mattermost-local",
      deploymentApproval: "PILOT_REHEARSAL_ONLY",
    });
    expect(validateGitLabPilotGateEvidence(evidence)).toMatchObject({
      gateKind: "PILOT_REHEARSAL",
      deploymentApproval: "PILOT_REHEARSAL_ONLY",
      productionDenied: true,
    });
  });

  it("requires an exact rehearsal binding before pilot approval", () => {
    const evidence = withHash({
      ...common,
      gateKind: "PILOT_RELEASE",
      contourKey: "qa-jira-gitlab-mattermost-test",
      deploymentApproval: "PILOT_APPROVED",
      pilotRehearsalEvidenceRef: "reports/005-gitlab-automated-validation/pilot-rehearsal.json",
      pilotRehearsalEvidenceHash: hash("7"),
    });
    expect(validateGitLabPilotGateEvidence(evidence)).toMatchObject({
      gateKind: "PILOT_RELEASE",
      deploymentApproval: "PILOT_APPROVED",
      mattermostOutageDegradation: "PASS",
    });
  });

  it("rejects hand-edited authority evidence", () => {
    const evidence = withHash({
      ...common,
      gateKind: "PILOT_REHEARSAL",
      contourKey: "qa-jira-gitlab-mattermost-local",
      deploymentApproval: "PILOT_REHEARSAL_ONLY",
    });
    expect(() =>
      validateGitLabPilotGateEvidence({ ...evidence, deploymentApproval: "PILOT_APPROVED" }),
    ).toThrow("PILOT_GATE_CONTENT_HASH_MISMATCH");
  });
});
