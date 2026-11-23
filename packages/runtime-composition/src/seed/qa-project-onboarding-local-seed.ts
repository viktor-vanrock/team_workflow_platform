import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ExactRevisionRef, HumanActorSnapshot } from "@awp/platform-core";

const ref = (id: string, version = 1): ExactRevisionRef =>
  Object.freeze({ id, version, contentHash: sha256({ id, version } as JsonValue) });
const actor = (principalId: string, roleKey: string): HumanActorSnapshot =>
  Object.freeze({
    kind: "HUMAN",
    principalId,
    roleKey,
    authorizationBasisRef: ref(`basis:${principalId}`),
    authenticationContextRef: ref(`authn:${principalId}`),
  });

export const qaProjectOnboardingLocalSeed = Object.freeze({
  now: "2026-09-03T12:00:00.000Z",
  later: "2026-09-03T13:00:00.000Z",
  workspaceId: "00000000-0000-4000-8000-000000000701",
  projectId: "00000000-0000-4000-8000-000000000711",
  sequentialPilotProjectId: "00000000-0000-4000-8000-000000000712",
  forbiddenProjectId: "00000000-0000-4000-8000-000000000713",
  workItemId: "00000000-0000-4000-8000-000000000742",
  sessionId: "00000000-0000-4000-8000-000000000743",
  integrationAdministrator: actor("00000000-0000-4000-8000-000000000721", "system-administrator"),
  workspaceOwner: Object.freeze({
    ...actor("00000000-0000-4000-8000-000000000722", "system-administrator"),
    stepUpAt: "2026-09-03T12:00:00.000Z",
  }),
  qaLead: actor("00000000-0000-4000-8000-000000000723", "qa-lead"),
  qaEngineer: actor("00000000-0000-4000-8000-000000000724", "qa-engineer"),
  service: Object.freeze({
    kind: "SERVICE" as const,
    principalId: "00000000-0000-4000-8000-000000000725",
    serviceKey: "project-onboarding-worker",
  }),
  correlationId: "00000000-0000-4000-8000-000000000731",
  fullQaFixture: Object.freeze({
    pipelineKey: "qa.validation",
    resultJobKey: "machine-result",
    mattermostHealth: "DEGRADED" as const,
    fallback: "WEB_AND_OUTBOX" as const,
    rolloutLeasePurpose: "FIRST_PILOT_ACTIVATION" as const,
  }),
  accessMatrix: Object.freeze({
    projects: Object.freeze([
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000711",
        classification: Object.freeze({ key: "INTERNAL", rank: 10 }),
      }),
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000712",
        classification: Object.freeze({ key: "RESTRICTED", rank: 20 }),
      }),
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000713",
        classification: Object.freeze({ key: "INTERNAL", rank: 10 }),
        hidden: true,
      }),
    ]),
    principals: Object.freeze([
      Object.freeze({
        principalId: "00000000-0000-4000-8000-000000000723",
        roleKey: "qa-lead",
        projectIds: Object.freeze([
          "00000000-0000-4000-8000-000000000711",
          "00000000-0000-4000-8000-000000000712",
        ]),
      }),
      Object.freeze({
        principalId: "00000000-0000-4000-8000-000000000724",
        roleKey: "qa-engineer",
        projectIds: Object.freeze(["00000000-0000-4000-8000-000000000711"]),
      }),
    ]),
  }),
  evidencePolicy: Object.freeze({
    signingKeyId: "local-ed25519:1",
    algorithm: "Ed25519" as const,
    serialization: "JCS_RFC8785" as const,
    signatureFormat: "JWS_DETACHED" as const,
    retentionDays: 30,
    preserveMetadataAfterExpiry: true,
    redactionPolicy: "NO_PROVIDER_LOCATORS" as const,
  }),
  suspensionFaults: Object.freeze({
    incidentRef: "INC-007",
    suspendBetweenIntentAndEffect: true,
    notificationTransport: "UNAVAILABLE",
    resumeCases: Object.freeze(["STALE_PROBES", "SELF_APPROVAL", "VALID_OWNER_APPROVAL"]),
  }),
  refs: Object.freeze({
    binding: ref("00000000-0000-4000-8000-000000000751"),
    fullQaBinding: ref("00000000-0000-4000-8000-000000000751", 2),
    automationSuite: ref("00000000-0000-4000-8000-000000000759"),
    gitLabProfile: ref("00000000-0000-4000-8000-000000000781"),
    gitLabConnection: ref("00000000-0000-4000-8000-000000000782"),
    gitLabMapping: ref("00000000-0000-4000-8000-000000000783"),
    fullQaValidation: ref("00000000-0000-4000-8000-000000000784"),
    context: ref("00000000-0000-4000-8000-000000000752"),
    environment: ref("00000000-0000-4000-8000-000000000753"),
    testData: ref("00000000-0000-4000-8000-000000000754"),
    accountPool: ref("00000000-0000-4000-8000-000000000755"),
    requirements: ref("00000000-0000-4000-8000-000000000756"),
    checklist: ref("00000000-0000-4000-8000-000000000757"),
    policy: ref("00000000-0000-4000-8000-000000000758"),
  }),
  exactRef: ref,
});
