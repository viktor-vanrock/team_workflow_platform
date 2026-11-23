import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildQaAuditDelta,
  buildQaDomainEvent,
  type QaEventType,
} from "../../packages/competency-qa/src/index.ts";
import { OfflineSchemaRegistry } from "../../packages/platform-contracts/src/index.ts";
import {
  type AuditEvent,
  AuditWriter,
  type WorkspaceContext,
} from "../../packages/platform-core/src/index.ts";

type JsonObject = Record<string, unknown>;

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/examples");
const registry = new OfflineSchemaRegistry();
const eventsSchema = "urn:awp:schemas:qa:events:v1";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workItemId = "33333333-3333-4333-8333-333333333333";
const entityId = "44444444-4444-4444-8444-444444444444";
const actorId = "77777777-7777-4777-8777-777777777777";
const digest = `sha256:${"a".repeat(64)}` as const;
const secondDigest = `sha256:${"b".repeat(64)}`;

const revisionRef = (version = 1): JsonObject => ({
  id: "55555555-5555-4555-8555-555555555555",
  version,
  contentHash: version === 1 ? digest : secondDigest,
});
const contentRef = (): JsonObject => ({
  id: "66666666-6666-4666-8666-666666666666",
  contentHash: digest,
});
const planRef = (revision = 1): JsonObject => ({
  id: "88888888-8888-4888-8888-888888888888",
  revision,
  contentHash: revision === 1 ? digest : secondDigest,
});
const assessmentRef = (): JsonObject => ({
  assessmentId: "99999999-9999-4999-8999-999999999999",
  version: 1,
  contentHash: digest,
});
const actionRef = (): JsonObject => ({
  platformActionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  approvalRef: {
    approvalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    subjectHash: digest,
  },
});

interface EventFamily {
  readonly definition: string;
  readonly eventType: QaEventType;
  readonly entityType: string;
  readonly payload: JsonObject;
}

async function fixture(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(examples, path), "utf8")) as JsonObject;
}

function expectValid(definition: string, value: unknown): void {
  expect(() => registry.validateById(`${eventsSchema}#/$defs/${definition}`, value)).not.toThrow();
}

function expectInvalid(definition: string, value: unknown): void {
  expect(() => registry.validateById(`${eventsSchema}#/$defs/${definition}`, value)).toThrow();
}

function snapshots(): JsonObject {
  return {
    targetSnapshotRef: contentRef(),
    scopeSnapshotRef: {
      id: "67676767-6767-4767-8767-676767676767",
      contentHash: secondDigest,
    },
    targetSnapshotHash: digest,
    scopeSnapshotHash: secondDigest,
  };
}

function sessionPayload(previousState: string, state: string, extra: JsonObject = {}): JsonObject {
  return {
    workItemId,
    sessionId: entityId,
    requiredSessionPlanRef: planRef(),
    previousState,
    state,
    authorizationBasisHash: digest,
    ...extra,
  };
}

async function eventFamilies(): Promise<readonly EventFamily[]> {
  const dodSatisfied = await fixture("positive/dod-satisfied-event.valid.json");
  const postClose = await fixture("positive/post-close-correction-recorded-event.valid.json");
  return [
    {
      definition: "RequestAcceptedEvent",
      eventType: "qa.request.accepted",
      entityType: "qa-request",
      payload: {
        workItemId,
        qaRequestExtensionId: entityId,
        initialRequestInputRevisionRef: revisionRef(),
        externalRequestId: "REQ-42",
        externalVersion: "1",
        rawExternalState: "OPEN",
        normalizedStatus: "NEW",
        bindingRef: { id: entityId, version: 1 },
        profileRefs: [{ id: workItemId, version: 1 }],
      },
    },
    {
      definition: "RequestInputRevisedEvent",
      eventType: "qa.request.input-revised",
      entityType: "qa-request-input",
      payload: {
        workItemId,
        previousRequestInputRevisionRef: revisionRef(),
        requestInputRevisionRef: revisionRef(2),
        responseChannelState: "CONFIRMED",
        invalidatedReadinessAssessmentRefs: [],
        invalidatedWaiverRefs: [],
        invalidatedPendingReadyCommandRefs: [],
        changeReasonCode: "MISSING_INFO_SUPPLIED",
        changeReason: "Requester supplied the missing facts",
      },
    },
    {
      definition: "ReadinessAssessedEvent",
      eventType: "qa.readiness.assessed",
      entityType: "qa-readiness-assessment",
      payload: {
        workItemId,
        assessmentRef: assessmentRef(),
        state: "READY",
        inputFingerprint: digest,
        blockerCodes: [],
      },
    },
    {
      definition: "ReadinessConfirmedEvent",
      eventType: "qa.readiness.confirmed",
      entityType: "qa-request",
      payload: {
        workItemId,
        assessmentRef: assessmentRef(),
        rawExternalState: "READY",
        normalizedStatus: "READY",
        externalVersion: "2",
        commandId: entityId,
      },
    },
    {
      definition: "RequiredSessionPlanPublishedEvent",
      eventType: "qa.required-session-plan.published",
      entityType: "qa-required-session-plan",
      payload: {
        workItemId,
        requiredSessionPlanRef: planRef(),
        previousRevisionRef: null,
        readinessAssessmentRef: assessmentRef(),
        publicationReason: "INITIAL",
        requirementCount: 1,
      },
    },
    {
      definition: "SessionStateChangedEvent",
      eventType: "qa.test-session.state-changed",
      entityType: "qa-test-session",
      payload: sessionPayload("PLANNED", "READY", snapshots()),
    },
    {
      definition: "SessionReviewedEvent",
      eventType: "qa.test-session.reviewed",
      entityType: "qa-test-session",
      payload: {
        workItemId,
        sessionId: entityId,
        requiredSessionPlanRef: planRef(),
        sessionReviewRef: revisionRef(),
        adjudicativeManifestRevisionRef: revisionRef(2),
        frozenFindingReviewRefs: [],
        sessionOutcome: "PASSED",
      },
    },
    {
      definition: "PlanItemResultRecordedEvent",
      eventType: "qa.plan-item.result-recorded",
      entityType: "qa-plan-item",
      payload: {
        workItemId,
        sessionId: entityId,
        planItemId: "12121212-1212-4212-8212-121212121212",
        resultRevisionRef: revisionRef(),
        attemptMembershipMode: "ALL_FINALIZED_CONTIGUOUS",
        consideredAttemptRefs: [],
        consideredAttemptSetHash: digest,
        observationMembershipMode: "ALL_CURRENT_LEAVES",
        consideredObservationRefs: [],
        consideredObservationSetHash: secondDigest,
        maximumAttemptNo: 0,
        result: "NOT_RUN",
        reviewFlags: [],
        waiverRef: revisionRef(2),
      },
    },
    {
      definition: "FindingClassifiedEvent",
      eventType: "qa.finding.classified",
      entityType: "qa-finding",
      payload: {
        workItemId,
        sessionId: entityId,
        findingId: "13131313-1313-4313-8313-131313131313",
        findingReviewRevisionRef: revisionRef(),
        classification: "PRODUCT",
      },
    },
    {
      definition: "FindingDisposedEvent",
      eventType: "qa.finding.disposed",
      entityType: "qa-finding",
      payload: {
        workItemId,
        sessionId: entityId,
        findingId: "13131313-1313-4313-8313-131313131313",
        findingReviewRevisionRef: revisionRef(2),
        classification: "PRODUCT",
        dispositionDecision: "CREATE_DEFECT",
      },
    },
    {
      definition: "DefectLinkedEvent",
      eventType: "qa.defect.linked",
      entityType: "qa-defect-link",
      payload: {
        workItemId,
        findingId: "13131313-1313-4313-8313-131313131313",
        defectDraftId: "14141414-1414-4414-8414-141414141414",
        defectLinkId: "15151515-1515-4515-8515-151515151515",
        externalDefectId: "DEF-42",
        externalVersion: "1",
        commandId: entityId,
      },
    },
    {
      definition: "EvidenceManifestSignedEvent",
      eventType: "qa.evidence.manifest-signed",
      entityType: "qa-evidence-manifest",
      payload: {
        workItemId,
        sessionId: entityId,
        requiredSessionPlanRef: planRef(),
        manifestRevisionId: "16161616-1616-4616-8616-161616161616",
        version: 1,
        contentHash: digest,
        artifactIds: [],
      },
    },
    {
      definition: "VerdictSignedEvent",
      eventType: "qa.verdict.signed",
      entityType: "qa-verdict",
      payload: {
        workItemId,
        requiredSessionPlanRef: planRef(),
        verdictId: "17171717-1717-4717-8717-171717171717",
        version: 1,
        verdict: "PASS",
        effectiveRisk: "LOW",
        contentHash: digest,
        signatureIds: ["18181818-1818-4818-8818-181818181818"],
      },
    },
    {
      definition: "DodAssessedEvent",
      eventType: "qa.dod.assessed",
      entityType: "qa-dod-assessment",
      payload: {
        workItemId,
        dodAssessmentId: entityId,
        state: "BLOCKED",
        inputFingerprint: digest,
        blockerCodes: ["MISSING_REQUIRED_SESSION_PLAN"],
      },
    },
    {
      definition: "DodSatisfiedEvent",
      eventType: "qa.dod.satisfied",
      entityType: "qa-dod-assessment",
      payload: dodSatisfied.payload as JsonObject,
    },
    {
      definition: "PostCloseCorrectionRecordedEvent",
      eventType: "qa.post-close-correction.recorded",
      entityType: "qa-post-close-correction",
      payload: postClose.payload as JsonObject,
    },
  ];
}

function envelope(family: EventFamily, ordinal: number): JsonObject {
  const suffix = String(ordinal + 20).padStart(2, "0");
  return buildQaDomainEvent({
    context: {
      actor: {
        kind: "HUMAN",
        principalId: actorId,
        issuer: "https://id.example.test",
        subject: "qa-executor-1",
      },
      scope: { kind: "PROJECT", workspaceId, projectId },
      correlationId: "70707070-7070-4070-8070-707070707070",
      causationId: "80808080-8080-4080-8080-808080808080",
    },
    eventId: `${suffix}${suffix}${suffix}${suffix}-${suffix}${suffix}-4${suffix.slice(1)}${suffix}-8${suffix.slice(1)}${suffix}-${suffix.repeat(6)}`,
    eventType: family.eventType,
    occurredAt: "2026-08-27T12:00:00Z",
    recordedAt: "2026-08-27T12:00:01Z",
    entityType: family.entityType,
    entityId,
    entityVersion: 1,
    dataClassificationKey: ordinal % 2 === 0 ? "INTERNAL" : "CONFIDENTIAL",
    payloadSchemaRef: {
      id: `urn:awp:schemas:qa:event-payload:${family.eventType.replace(/^qa\./u, "").replaceAll(".", "-")}:v1`,
      version: 1,
      digest,
    },
    payload: family.payload,
  }) as unknown as JsonObject;
}

describe("Feature 002 QA event and audit contracts", () => {
  it("round-trips every closed QA event family with scope and classification intact", async () => {
    const families = await eventFamilies();
    expect(families).toHaveLength(16);
    for (const [ordinal, family] of families.entries()) {
      const original = envelope(family, ordinal);
      const roundTripped = JSON.parse(JSON.stringify(original)) as JsonObject;
      expectValid(family.definition, roundTripped);
      expect(roundTripped).toEqual(original);
      expect(roundTripped).toMatchObject({
        workspaceId,
        projectId,
        eventType: family.eventType,
        entityType: family.entityType,
        dataClassificationKey: ordinal % 2 === 0 ? "INTERNAL" : "CONFIDENTIAL",
      });
      expectInvalid(family.definition, { ...roundTripped, unexpected: true });
    }
  });

  it("enforces the closed Session transition-pair, milestone, snapshot and reason matrix", () => {
    const legal: readonly JsonObject[] = [
      sessionPayload("PLANNED", "READY", snapshots()),
      sessionPayload("PLANNED", "BLOCKED", {
        reachedMilestone: "PLANNED",
        reason: "Missing target",
      }),
      sessionPayload("PLANNED", "CANCELLED", {
        reachedMilestone: "PLANNED",
        reason: "Request withdrawn",
      }),
      sessionPayload("READY", "RUNNING", snapshots()),
      sessionPayload("READY", "BLOCKED", {
        ...snapshots(),
        reachedMilestone: "READY",
        reason: "Environment down",
      }),
      sessionPayload("READY", "CANCELLED", {
        ...snapshots(),
        reachedMilestone: "READY",
        reason: "Request withdrawn",
      }),
      sessionPayload("RUNNING", "REVIEW_REQUIRED", snapshots()),
      sessionPayload("RUNNING", "BLOCKED", {
        ...snapshots(),
        reachedMilestone: "RUNNING",
        reason: "Execution blocked",
      }),
      sessionPayload("RUNNING", "CANCELLED", {
        ...snapshots(),
        reachedMilestone: "RUNNING",
        reason: "Request withdrawn",
      }),
      sessionPayload("REVIEW_REQUIRED", "COMPLETED", {
        ...snapshots(),
        sessionOutcome: "PASSED",
        sessionReviewRef: revisionRef(),
        evidenceManifestRevisionRef: revisionRef(2),
      }),
      sessionPayload("REVIEW_REQUIRED", "BLOCKED", {
        ...snapshots(),
        reachedMilestone: "REVIEW_REQUIRED",
        reason: "Review blocked",
      }),
      sessionPayload("REVIEW_REQUIRED", "CANCELLED", {
        ...snapshots(),
        reachedMilestone: "REVIEW_REQUIRED",
        reason: "Request withdrawn",
      }),
      sessionPayload("BLOCKED", "READY", snapshots()),
      sessionPayload("BLOCKED", "RUNNING", snapshots()),
      sessionPayload("BLOCKED", "REVIEW_REQUIRED", snapshots()),
      sessionPayload("BLOCKED", "CANCELLED", {
        ...snapshots(),
        reachedMilestone: "RUNNING",
        reason: "Request withdrawn",
      }),
    ];
    for (const payload of legal) expectValid("SessionStateChangedPayload", payload);

    const previousStates = ["PLANNED", "READY", "RUNNING", "REVIEW_REQUIRED", "BLOCKED"] as const;
    const states = [
      "READY",
      "RUNNING",
      "REVIEW_REQUIRED",
      "COMPLETED",
      "BLOCKED",
      "CANCELLED",
    ] as const;
    const legalPairs = new Set(
      legal.map(({ previousState, state }) => `${String(previousState)}:${String(state)}`),
    );
    for (const previousState of previousStates) {
      for (const state of states) {
        if (legalPairs.has(`${previousState}:${state}`)) continue;
        expectInvalid(
          "SessionStateChangedPayload",
          sessionPayload(previousState, state, snapshots()),
        );
      }
    }
    expectInvalid(
      "SessionStateChangedPayload",
      sessionPayload("READY", "BLOCKED", {
        ...snapshots(),
        reachedMilestone: "PLANNED",
        reason: "Wrong milestone",
      }),
    );
    expectInvalid(
      "SessionStateChangedPayload",
      sessionPayload("PLANNED", "BLOCKED", {
        reachedMilestone: "PLANNED",
      }),
    );
    expectInvalid(
      "SessionStateChangedPayload",
      sessionPayload("PLANNED", "BLOCKED", {
        ...snapshots(),
        reachedMilestone: "PLANNED",
        reason: "Future snapshots are forbidden",
      }),
    );
  });

  it("closes request-input and RequiredSessionPlan initial-versus-revision lineage", async () => {
    const revisedEvent = await fixture("positive/request-input-revised-event.valid.json");
    expectValid("RequestInputRevisedEvent", revisedEvent);
    const revisedPayload = revisedEvent.payload as JsonObject;
    expectInvalid("RequestInputRevisedPayload", { ...revisedPayload, changeReason: undefined });
    expectInvalid("RequestInputRevisedPayload", {
      ...revisedPayload,
      previousRequestInputRevisionRef: undefined,
    });

    const initial = {
      workItemId,
      requiredSessionPlanRef: planRef(),
      previousRevisionRef: null,
      readinessAssessmentRef: assessmentRef(),
      publicationReason: "INITIAL",
      requirementCount: 1,
    };
    const revision = {
      ...initial,
      requiredSessionPlanRef: planRef(2),
      previousRevisionRef: planRef(),
      publicationReason: "CORRECTION",
    };
    expectValid("RequiredSessionPlanPublishedPayload", initial);
    expectValid("RequiredSessionPlanPublishedPayload", revision);
    expectInvalid("RequiredSessionPlanPublishedPayload", {
      ...initial,
      previousRevisionRef: planRef(),
    });
    expectInvalid("RequiredSessionPlanPublishedPayload", {
      ...revision,
      previousRevisionRef: null,
    });
  });

  it("enforces risk-dependent Verdict signature cardinality", () => {
    const signatureIds = [
      "18181818-1818-4818-8818-181818181818",
      "19191919-1919-4919-8919-191919191919",
    ];
    for (const [risk, count] of [
      ["LOW", 1],
      ["MEDIUM", 1],
      ["HIGH", 2],
      ["CRITICAL", 2],
    ] as const) {
      const payload = {
        workItemId,
        requiredSessionPlanRef: planRef(),
        verdictId: entityId,
        version: 1,
        verdict: "PASS",
        effectiveRisk: risk,
        contentHash: digest,
        signatureIds: signatureIds.slice(0, count),
      };
      expectValid("VerdictSignedPayload", payload);
      expectInvalid("VerdictSignedPayload", {
        ...payload,
        signatureIds: signatureIds.slice(0, count === 1 ? 2 : 1),
      });
    }
  });

  it("requires a Finding platform-action ref iff the disposition consumes approval", () => {
    for (const decision of ["CREATE_DEFECT", "DUPLICATE", "NOT_A_BUG", "DEFERRED"] as const) {
      const payload = {
        workItemId,
        sessionId: entityId,
        findingId: entityId,
        findingReviewRevisionRef: revisionRef(),
        classification: decision === "DUPLICATE" ? "DUPLICATE" : "PRODUCT",
        dispositionDecision: decision,
      };
      expectValid("FindingDisposedPayload", payload);
      expectInvalid("FindingDisposedPayload", { ...payload, platformActionRef: actionRef() });
    }
    for (const decision of ["ACCEPTED_RISK", "WAIVED"] as const) {
      const payload = {
        workItemId,
        sessionId: entityId,
        findingId: entityId,
        findingReviewRevisionRef: revisionRef(),
        classification: decision === "ACCEPTED_RISK" ? "ACCEPTED_RISK" : "PRODUCT",
        dispositionDecision: decision,
        platformActionRef: actionRef(),
      };
      expectValid("FindingDisposedPayload", payload);
      const withoutAction = Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== "platformActionRef"),
      );
      expectInvalid("FindingDisposedPayload", withoutAction);
    }
  });

  it("permits DoD BLOCKED without a plan but requires the exact plan for closure", () => {
    const blocked = {
      workItemId,
      dodAssessmentId: entityId,
      state: "BLOCKED",
      inputFingerprint: digest,
      blockerCodes: ["MISSING_REQUIRED_SESSION_PLAN"],
    };
    const ready = {
      ...blocked,
      state: "READY_TO_CLOSE",
      requiredSessionPlanRef: planRef(),
      blockerCodes: [],
    };
    expectValid("DodAssessedPayload", blocked);
    expectValid("DodAssessedPayload", ready);
    expectInvalid("DodAssessedPayload", { ...blocked, blockerCodes: [] });
    const readyWithoutPlan = Object.fromEntries(
      Object.entries(ready).filter(([key]) => key !== "requiredSessionPlanRef"),
    );
    expectInvalid("DodAssessedPayload", readyWithoutPlan);
  });

  it("preserves each family classification in audit while redacting payload and secrets", async () => {
    const families = await eventFamilies();
    const appended: AuditEvent[] = [];
    const writer = new AuditWriter(
      {
        append: async (event) => {
          appended.push(event);
        },
        query: async () => appended,
      },
      { now: () => new Date("2026-08-27T12:00:00Z") },
      { next: () => entityId },
    );
    const context: WorkspaceContext = {
      actor: {
        kind: "HUMAN",
        principalId: actorId,
        issuer: "https://id.example.test",
        subject: "qa-executor-1",
      },
      scope: { kind: "PROJECT", workspaceId, projectId },
      correlationId: "70707070-7070-4070-8070-707070707070",
      causationId: "80808080-8080-4080-8080-808080808080",
    };
    for (const [ordinal, family] of families.entries()) {
      const classification =
        ordinal % 2 === 0 ? { key: "INTERNAL", rank: 10 } : { key: "CONFIDENTIAL", rank: 20 };
      const delta = buildQaAuditDelta({
        action: family.eventType,
        outcome: "SUCCEEDED",
        reasonCode: "QA_EVENT_RECORDED",
        attributes: {
          entityType: family.entityType,
          operation: family.eventType,
          reason: "event recorded",
          payload: family.payload,
          authorizationBasisHash: digest,
          accessToken: "Bearer raw-secret-token",
          objectLocator: "s3://private-bucket/raw-evidence",
        },
      });
      expect(delta.attributes).toEqual({
        entityType: family.entityType,
        operation: family.eventType,
        reason: "event recorded",
      });
      const audit = await writer.write(context, {
        action: delta.action,
        outcome: "SUCCEEDED",
        reasonCode: delta.reasonCode,
        classification,
        ...(delta.attributes ? { attributes: delta.attributes } : {}),
      });
      expect(audit.classification).toEqual(classification);
      expect(audit.attributes).toEqual({
        entityType: family.entityType,
        operation: family.eventType,
        reason: "event recorded",
      });
      expect(JSON.stringify(audit)).not.toContain("raw-secret-token");
      expect(JSON.stringify(audit)).not.toContain("private-bucket");
      expect(JSON.stringify(audit)).not.toContain("workItemId");
    }
    expect(appended).toHaveLength(16);
  });
});
