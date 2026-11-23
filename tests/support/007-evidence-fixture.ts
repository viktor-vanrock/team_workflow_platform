import { buildTargetSnapshotV2 } from "../../packages/competency-qa/src/application/target-snapshot-builder-v2.ts";
import { evidenceContentHash } from "../../packages/competency-qa/src/domain/evidence-manifest-v2.ts";
import { exactRef, onboardingFixture, projectScope } from "./007-onboarding-fixture.ts";

export const evidenceTarget = () =>
  buildTargetSnapshotV2({
    snapshotId: "snapshot-v2",
    ...projectScope(),
    workItemId: "work",
    sessionId: "session",
    mode: "AUTOMATED",
    sourceRefs: [exactRef("source")],
    buildRef: exactRef("build"),
    environmentRef: exactRef("environment"),
    testDataRefs: [exactRef("data")],
    accountLeaseRefs: [],
    definitionRefs: [exactRef("definition")],
    policyRefs: [exactRef("policy")],
    bindingRef: exactRef("binding"),
    configurationPins: ["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"].map(
      (logicalRole) => ({
        logicalRole,
        capabilityKey: logicalRole.toLowerCase(),
        exactContractVersion: "1.0.0",
        profileRef: exactRef(`profile-${logicalRole}`),
        connectionRef: exactRef(`connection-${logicalRole}`),
        mappingRef: exactRef(`mapping-${logicalRole}`),
        validationReportRef: exactRef(`validation-${logicalRole}`),
        operationSetHash: evidenceContentHash([logicalRole]),
        externalScopeHash: evidenceContentHash({ projectId: onboardingFixture.projectA }),
      }),
    ),
    modeConfiguration: {
      schemaRef: exactRef("mode-schema"),
      value: { mode: "AUTOMATED" },
      contentHash: evidenceContentHash({ mode: "AUTOMATED" }),
    },
    capturedAt: onboardingFixture.now,
  });

export const manifestInput = () => ({
  manifestRevisionId: "manifest-r1",
  manifestId: "manifest",
  version: 1,
  kind: "INITIAL" as const,
  ...projectScope(),
  workItemId: "work",
  sessionId: "session",
  targetSnapshot: evidenceTarget(),
  planItems: [{ planItemId: "plan", result: "PASS" }],
  attempts: [
    {
      attemptId: "attempt",
      planItemId: "plan",
      result: "PASS",
      actorId: onboardingFixture.qaEngineerId,
      startedAt: onboardingFixture.now,
      endedAt: onboardingFixture.later,
    },
  ],
  findings: [],
  artifacts: [
    {
      artifactId: "artifact",
      checksum: evidenceContentHash("bytes"),
      classificationKey: "RESTRICTED",
      classificationRank: 20,
      availability: "AVAILABLE" as const,
    },
  ],
  provenance: [{ kind: "SESSION", id: "session" }],
  humanAttestation: {
    actor: { kind: "HUMAN", principalId: onboardingFixture.qaLeadId },
    attestedAt: onboardingFixture.now,
  },
  createdAt: onboardingFixture.now,
});
