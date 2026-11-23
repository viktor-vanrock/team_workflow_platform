import { describe, expect, it } from "vitest";

import {
  deriveAutomationAvailability,
  type QaAutomationConfigurationIntersection,
} from "../../../packages/competency-qa/src/application/automation-availability.ts";
import {
  gitLabOperationIdentityRouting,
  validateGitLabConnectionConfiguration,
} from "../../../packages/connector-gitlab/src/index.ts";
import { RuntimeQaAutomationAvailability } from "../../../packages/runtime-composition/src/qa/automation-availability.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function intersection(): QaAutomationConfigurationIntersection {
  const bindingRef = { id: "binding-1", version: 1, contentHash: digest("a") };
  return {
    publishedSuite: { id: "suite-1", version: 2, contentHash: digest("b") },
    rolePins: [
      {
        logicalRole: "SOURCE_CONTEXT",
        capabilityKey: "source-context.read",
        exactContractVersion: "1.0.0",
        bindingRef,
        profileRef: { id: "profile-source", version: 1, contentHash: digest("c") },
        connectionRef: { id: "connection-1", version: 1, contentHash: digest("d") },
        validationReportRef: { id: "validation-source", version: 1, contentHash: digest("e") },
        current: true,
      },
      {
        logicalRole: "TEST_EXECUTION",
        capabilityKey: "test-executor.trigger-status",
        exactContractVersion: "1.0.0",
        bindingRef,
        profileRef: { id: "profile-execution", version: 1, contentHash: digest("f") },
        connectionRef: { id: "connection-1", version: 1, contentHash: digest("d") },
        validationReportRef: { id: "validation-execution", version: 1, contentHash: digest("1") },
        current: true,
      },
      {
        logicalRole: "ARTIFACT_SOURCE",
        capabilityKey: "artifact.ci-read",
        exactContractVersion: "1.0.0",
        bindingRef,
        profileRef: { id: "profile-artifact", version: 1, contentHash: digest("2") },
        connectionRef: { id: "connection-1", version: 1, contentHash: digest("d") },
        validationReportRef: { id: "validation-artifact", version: 1, contentHash: digest("3") },
        current: true,
      },
    ],
    validationEvidence: { exact: true, current: true },
    authorizationCurrent: true,
    entitlementCurrent: true,
    nonProductionProven: true,
    liveHealth: { availability: "AVAILABLE", reasonCodes: [] },
  };
}

describe("qa.validation 1.2 capability/profile conformance", () => {
  it("derives FULL_QA only from the exact current three-role intersection", () => {
    expect(deriveAutomationAvailability(intersection())).toEqual({
      capabilityMode: "FULL_QA",
      configurationReasonCodes: [],
      liveAvailability: "AVAILABLE",
      liveReasonCodes: [],
      launchPermitted: true,
    });
    expect(
      deriveAutomationAvailability({
        ...intersection(),
        rolePins: intersection().rolePins.slice(0, 2),
      }),
    ).toMatchObject({
      capabilityMode: "MANUAL_ONLY",
      configurationReasonCodes: ["ROLE_INTERSECTION_INCOMPLETE"],
      launchPermitted: false,
    });
  });

  it("keeps live health independent from structural FULL_QA mode", () => {
    expect(
      deriveAutomationAvailability({
        ...intersection(),
        liveHealth: { availability: "UNAVAILABLE", reasonCodes: ["GITLAB_AUTH_REVOKED"] },
      }),
    ).toEqual({
      capabilityMode: "FULL_QA",
      configurationReasonCodes: [],
      liveAvailability: "UNAVAILABLE",
      liveReasonCodes: ["GITLAB_AUTH_REVOKED"],
      launchPermitted: false,
    });
  });

  it("reduces the server-owned runtime projection without provider reads", async () => {
    let loads = 0;
    const projection = new RuntimeQaAutomationAvailability({
      async current(scope) {
        loads += 1;
        expect(scope).toEqual({ workspaceId: "workspace-1", projectId: "project-1" });
        return intersection();
      },
    });

    await expect(
      projection.current({ workspaceId: "workspace-1", projectId: "project-1" }),
    ).resolves.toMatchObject({ capabilityMode: "FULL_QA", launchPermitted: true });
    expect(loads).toBe(1);
  });

  it("keeps read, trigger and webhook identity slots distinct with exact operation routing", () => {
    const common = {
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotate",
      revocationRunbookRef: "runbook:revoke",
    };
    const configuration = validateGitLabConnectionConfiguration({
      schemaVersion: "gitlab-connection-configuration@1.0.0",
      identityReferences: {
        read: {
          ...common,
          identityKind: "NON_HUMAN_PROJECT",
          scope: "read_api",
          nonHumanIdentityEvidenceRef: "evidence:read",
          reference: "secretref://gitlab/read",
          referenceFingerprint: digest("4"),
        },
        trigger: {
          ...common,
          identityKind: "NON_HUMAN_PROJECT",
          scope: "pipeline_trigger",
          nonHumanIdentityEvidenceRef: "evidence:trigger",
          reference: "secretref://gitlab/trigger",
          referenceFingerprint: digest("5"),
        },
        webhook: {
          ...common,
          identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
          keyVersionRef: "key:webhook:v1",
          reference: "secretref://gitlab/webhook",
          referenceFingerprint: digest("6"),
        },
      },
      operationIdentityRouting: gitLabOperationIdentityRouting,
      identitySeparationEvidenceHash: digest("7"),
    });

    expect(
      new Set(Object.values(configuration.identityReferences).map(({ reference }) => reference))
        .size,
    ).toBe(3);
    expect(configuration.operationIdentityRouting).toEqual(gitLabOperationIdentityRouting);
  });

  it("rejects provider authority as Suite selectors", () => {
    const providerNeutral = JSON.stringify({
      suiteKey: "smoke",
      target: { type: "MERGE_REQUEST", sourceRef: "mr:17" },
      environmentRef: "environment:local",
      parameters: { browser: "chromium" },
    });
    expect(providerNeutral).not.toMatch(
      /profileId|connectionId|numericGitLabProjectId|jobName|variableName|secretRef/iu,
    );
  });
});
