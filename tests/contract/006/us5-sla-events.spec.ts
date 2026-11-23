import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  projectQueuePolicyFacet,
} from "../../../packages/platform-core/src/index.ts";
import {
  planSlaThresholds,
  slaClockTransitionEventEnvelope,
  slaThresholdEventEnvelope,
  SlaThresholdNotificationService,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `71000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function values() {
  const calendar = businessCalendarFixture();
  const policy = projectQueuePolicyFacet(
    queuePolicyFixture("ENFORCED", calendar),
    policyIds.projectA,
    { id: id("1"), version: 1 },
  );
  const started = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: id("2"),
    slaClockId: id("3"),
    goal: "READY_TO_FIRST_QA_START",
    policyFacetRef: policy.policyFacetRef,
    calendarRef: policy.calendarRef,
    mappingRef: {
      ...policy.statusMappingRef,
      sourceVersion: Number(policy.statusMappingRef.sourceVersion),
    },
    algorithmRef: {
      key: "sla-business-time",
      version: "1.0.0",
      semanticHash: digest("sla-business-time@1"),
    },
    startSourceRef: {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: id("4"),
      sourceVersion: 1,
      semanticHash: digest("jira-ready"),
      observedAt: "2026-09-07T04:59:00.000Z",
      confirmedAt: "2026-09-07T05:00:00.000Z",
    },
  });
  const paused = advanceSlaClock({
    current: started,
    calendar,
    command: {
      kind: "PAUSE",
      mappedPauseReasonCode: "WAITING_EXTERNAL",
      sourceRef: {
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
        sourceId: id("5"),
        sourceVersion: 2,
        semanticHash: digest("jira-blocked"),
        observedAt: "2026-09-07T06:59:00.000Z",
        confirmedAt: "2026-09-07T07:00:00.000Z",
      },
    },
  });
  if (paused.outcome !== "APPENDED") throw new Error("fixture");
  const resumed = advanceSlaClock({
    current: paused.transition,
    calendar,
    command: {
      kind: "RESUME",
      sourceRef: {
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
        sourceId: id("6"),
        sourceVersion: 3,
        semanticHash: digest("jira-resumed"),
        observedAt: "2026-09-07T07:59:00.000Z",
        confirmedAt: "2026-09-07T08:00:00.000Z",
      },
    },
  });
  if (resumed.outcome !== "APPENDED") throw new Error("fixture");
  const stopped = advanceSlaClock({
    current: resumed.transition,
    calendar,
    command: {
      kind: "STOP",
      effectiveAt: "2026-09-07T09:00:00.000Z",
      sourceRef: {
        sourceType: "QA_TEST_SESSION_REVISION",
        sourceId: id("7"),
        sourceVersion: 1,
        semanticHash: digest("session-started"),
      },
    },
  });
  if (stopped.outcome !== "APPENDED") throw new Error("fixture");
  return {
    calendar,
    policy,
    started,
    paused: paused.transition,
    resumed: resumed.transition,
    stopped: stopped.transition,
  };
}

describe("US5 immutable SLA event envelopes", () => {
  it("binds each clock transition once to its exact revision and schema pin", () => {
    const fixture = values();
    const transitions = [fixture.started, fixture.paused, fixture.resumed, fixture.stopped];
    const envelopes = transitions.map((transition, index) =>
      slaClockTransitionEventEnvelope({
        transition,
        correlationId: id(String(20 + index)),
        causationId: id(String(30 + index)),
      }),
    );
    expect(envelopes.map(({ eventType }) => eventType)).toEqual([
      "sla.clock.started",
      "sla.clock.paused",
      "sla.clock.resumed",
      "sla.clock.stopped",
    ]);
    for (const [index, envelope] of envelopes.entries()) {
      const transition = transitions[index]!;
      expect(envelope).toMatchObject({
        entityType: "sla-clock",
        entityId: transition.slaClockId,
        entityVersion: transition.clockRevisionRef.version,
        payloadVersion: 1,
        payloadSchemaRef: {
          id: "urn:awp:schemas:006:sla-clock-transition:v1",
          version: 1,
          digest: "sha256:39a0122a052a611fc817a63a245080481c8c05a727bb1690314d53e848788274",
        },
        payload: transition,
      });
      expect(() =>
        designContractRegistry.validateById(
          "urn:awp:schemas:006:sla-clock-transition:v1",
          envelope.payload as never,
        ),
      ).not.toThrow();
      expect(envelope.payload).not.toHaveProperty("asOf");
      expect(envelope.payload).not.toHaveProperty("evaluationHash");
      expect(envelope.payload).not.toHaveProperty("targetState");
    }
    expect(new Set(envelopes.map(({ eventId }) => eventId))).toHaveLength(4);
  });

  it("binds warning emission rather than a dynamic SLA read DTO", async () => {
    const fixture = values();
    const segment = applySlaClockTransitionToSegments({
      transition: fixture.started,
      calendar: fixture.calendar,
      nextSegmentId: id("40"),
    }).opened!;
    const crossing = planSlaThresholds({
      transition: fixture.started,
      calendar: fixture.calendar,
      segments: [segment],
      target: fixture.policy.slaGoals[0]!,
      asOf: "2026-09-07T10:00:00.000Z",
    }).crossings[0]!;
    const service = new SlaThresholdNotificationService({
      createNotificationIntent: async (intent) => ({ value: intent, replayed: false }),
      appendThresholdEmission: async () => ({ outcome: "APPENDED" }),
    });
    const emission = (
      await service.emit({
        transition: fixture.started,
        crossing,
        expiresAt: "2026-10-07T09:00:00.000Z",
      })
    ).emission;
    const envelope = slaThresholdEventEnvelope({ emission });
    expect(envelope).toMatchObject({
      eventType: "sla.warning",
      entityType: "sla-threshold-emission",
      entityId: emission.thresholdEmissionId,
      entityVersion: 1,
      payload: emission,
      payloadSchemaRef: {
        id: "urn:awp:schemas:006:sla-threshold-emission:v1",
        version: 1,
        digest: "sha256:fc3db628391931e73fcdf158ca99ce394452ce6cb5df86b2d5bfe2e1a33d00f7",
      },
    });
    expect(() =>
      designContractRegistry.validateById(
        "urn:awp:schemas:006:sla-threshold-emission:v1",
        envelope.payload as never,
      ),
    ).not.toThrow();
    expect(envelope.payload).not.toHaveProperty("rowVersion");
    expect(envelope.payload).not.toHaveProperty("deliveryState");
    expect(envelope.payload).not.toHaveProperty("evaluationHash");
  });
});
