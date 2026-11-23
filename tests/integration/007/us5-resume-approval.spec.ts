import { describe, expect, it } from "vitest";

import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  createOnboardingRevision,
  createProjectResumeActionCandidate,
  type ProjectActionApproval,
} from "../../../packages/platform-core/src/index.ts";
import { ProjectResumeService } from "../../../packages/runtime-composition/src/onboarding/action-consumers.ts";
import { InMemoryProjectSuspensionService } from "../../../packages/runtime-composition/src/onboarding/project-suspension-service.ts";
import { qaProjectOnboardingLocalSeed as seed } from "../../../packages/runtime-composition/src/seed/qa-project-onboarding-local-seed.ts";

describe("US5 resume approval", () => {
  it("requires probes, incident disposition, step-up and distinct owner", async () => {
    const service = new InMemoryProjectSuspensionService("FULL_QA");
    await service.suspend({
      expectedVersion: 1,
      idempotencyKey: "s",
      incidentRef: "INC",
      reason: "risk",
    });
    await expect(
      service.resume({
        expectedVersion: 2,
        idempotencyKey: "r",
        probesFresh: false,
        incidentAccepted: true,
        stepUp: true,
        distinctOwnerApproval: true,
        requirementsPass: true,
      }),
    ).rejects.toThrow("PROJECT_RESUME_PREREQUISITE_STALE");
  });

  it("consumes one exact current Owner approval and recalculates mode", async () => {
    const current = createOnboardingRevision({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      revisionId: "onboarding:v3",
      onboardingId: "onboarding",
      version: 3,
      stage: "SHADOW",
      qaCapabilityMode: "FULL_QA",
      operationalState: "SUSPENDED",
      intendedCapabilityMode: "FULL_QA",
      projectRegistryRef: seed.exactRef("registry"),
      bindingRef: seed.refs.fullQaBinding,
      qaProjectContextRef: seed.refs.context,
      starterEntitlementSetHash: sha256([]),
      gateResultRefs: [],
      ownerSetHash: sha256([seed.workspaceOwner.principalId]),
      reasonCode: "PROJECT_SUSPENDED",
      reason: "Incident containment",
      incidentRef: "INC-007",
      actor: seed.integrationAdministrator,
      correlationId: seed.correlationId,
      createdAt: seed.now,
    });
    const disposition = seed.exactRef("incident-disposition");
    const probe = seed.exactRef("probe");
    const candidate = createProjectResumeActionCandidate({
      current,
      actionId: "resume-action",
      incidentDispositionRef: disposition,
      freshProbeRefs: [probe],
      initiator: seed.integrationAdministrator,
      reason: "Incident accepted; resume exact Project",
      createdAt: seed.now,
      expiresAt: seed.later,
    });
    const approval: ProjectActionApproval = Object.freeze({
      approvalId: "resume-approval",
      subjectKind: "PLATFORM_ACTION",
      actionKind: "PROJECT_RESUME",
      actionId: candidate.actionId,
      targetHash: candidate.contentHash,
      initiatorPrincipalId: seed.integrationAdministrator.principalId,
      approver: seed.workspaceOwner,
      stepUpAt: seed.now,
      approvedAt: seed.now,
      expiresAt: seed.later,
    });
    const service = new ProjectResumeService();
    await expect(
      service.resume({
        current,
        candidate,
        approval,
        liveIncidentDispositionRef: disposition,
        incidentDispositionAccepted: true,
        liveFreshProbeRefs: [],
        currentRequirementsPass: true,
        initiatorCurrentlyAuthorized: true,
        approverCurrentlyAuthorized: true,
        now: seed.now,
      }),
    ).rejects.toThrow("PROJECT_ACTION_PREREQUISITE_STALE");
    const result = await service.resume({
      current,
      candidate,
      approval,
      liveIncidentDispositionRef: disposition,
      incidentDispositionAccepted: true,
      liveFreshProbeRefs: [probe],
      currentRequirementsPass: false,
      initiatorCurrentlyAuthorized: true,
      approverCurrentlyAuthorized: true,
      now: seed.now,
    });
    expect(result.revision).toMatchObject({
      operationalState: "ACTIVE",
      qaCapabilityMode: "MANUAL_ONLY",
      intendedCapabilityMode: "FULL_QA",
    });
    expect(result.consumedApproval.consumedAt).toBe(seed.now);
  });
});
