import { describe, expect, it } from "vitest";

import { ManualExecutionUnitOfWork } from "../../../packages/competency-qa/src/persistence/manual-execution.uow.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import { deriveBaseWipClaimDecision } from "../../../packages/platform-core/src/work-management/capacity-admission.ts";
import { MeasureOnlyManualAdmissionService } from "../../../packages/runtime-composition/src/queue/admission-service.ts";
import { createSessionFixture } from "../../support/002-session-fixture.ts";

describe("US1 first consuming Session WIP", () => {
  it.each([
    ["CANDIDATE", undefined, "NOT_CONSUMING"],
    ["BACKLOG", undefined, "NOT_CONSUMING"],
    ["READY", { mode: "MANUAL", state: "PLANNED" }, "NOT_CONSUMING"],
    ["READY", { mode: "MANUAL", state: "READY" }, "NOT_CONSUMING"],
    ["ACTIVE", { mode: "AUTOMATED", state: "RUNNING" }, "NOT_CONSUMING"],
  ] as const)("does not consume for %s / %s", (stage, activity, state) => {
    expect(
      deriveBaseWipClaimDecision({
        workItemId: "w1",
        stage,
        ...(activity === undefined ? {} : { activity }),
        policyMode: "MEASURE_ONLY",
      }),
    ).toMatchObject({ state });
  });

  it.each(["RUNNING", "REVIEW_REQUIRED"] as const)(
    "creates one idempotent Work Item claim for MANUAL %s",
    (state) => {
      const first = deriveBaseWipClaimDecision({
        workItemId: "w1",
        stage: "ACTIVE",
        activity: { mode: "MANUAL", state },
        policyMode: "MEASURE_ONLY",
      });
      expect(first).toMatchObject({ state: "CREATE", units: 1, cause: `MANUAL_${state}` });
      expect(
        deriveBaseWipClaimDecision({
          workItemId: "w1",
          stage: "ACTIVE",
          activity: { mode: "MANUAL", state },
          existingClaim: { workItemId: "w1", units: 1 },
          policyMode: "MEASURE_ONLY",
        }),
      ).toMatchObject({ state: "UNCHANGED", units: 1 });
    },
  );

  it("persists a schema-valid idempotent admission decision", async () => {
    let committed: Readonly<Record<string, unknown>> | undefined;
    const service = new MeasureOnlyManualAdmissionService({
      commit: async (value) => {
        committed = value;
        return { outcome: "COMMITTED", claimId: String(value.decision.claim?.claimId) };
      },
    });
    const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
    const source = (sourceType: string, sourceId: string, digit: string) => ({
      sourceType,
      sourceId,
      sourceVersion: 1,
      semanticHash: hash(digit),
    });
    await service.admit({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      workItemId: "00000000-0000-4000-8000-000000000003",
      sessionId: "00000000-0000-4000-8000-000000000004",
      requestKey: "manual-start-1",
      activityKind: "MANUAL_SESSION_START",
      stage: "ACTIVE",
      sessionState: "RUNNING",
      actor: { kind: "HUMAN", principalId: "00000000-0000-4000-8000-000000000005" },
      policyFacetRef: {
        id: "00000000-0000-4000-8000-000000000006",
        version: 1,
        semanticHash: hash("1"),
      },
      authorizedScopeSnapshotRef: {
        id: "00000000-0000-4000-8000-000000000007",
        version: 1,
        semanticHash: hash("2"),
      },
      authorizationScopeWitnessHash: hash("3"),
      expectedQueueControlVersion: 0,
      operationalProjectionRef: {
        ...source(
          "JIRA_OPERATIONAL_PROJECTION_REVISION",
          "00000000-0000-4000-8000-000000000008",
          "4",
        ),
        confirmedAt: "2026-09-02T10:00:00.000Z",
      },
      qaSourceSetHash: hash("5"),
      sessionRef: source("QA_TEST_SESSION_REVISION", "00000000-0000-4000-8000-000000000004", "6"),
      decidedAt: "2026-09-02T10:05:00.000Z",
      correlationId: "00000000-0000-4000-8000-000000000009",
      causationId: "00000000-0000-4000-8000-000000000010",
    });
    expect(() =>
      designContractRegistry.validateById(
        "urn:awp:schemas:006:capacity-admission:v1",
        committed!.eventPayload as never,
      ),
    ).not.toThrow();
  });

  it("runs capacity admission before the Session CAS on the shared executor", async () => {
    const order: string[] = [];
    const source = {
      query: async () => {
        order.push("session-cas");
        return [{ session_id: "s1" }];
      },
    };
    const planned = createSessionFixture({ id: "s1", ordinal: 1 });
    const previous = {
      ...planned,
      state: "READY" as const,
      resourceVersion: 2,
      readyAt: "2026-09-02T10:00:00.000Z",
    };
    const next = {
      ...previous,
      state: "RUNNING" as const,
      resourceVersion: 3,
      startedAt: "2026-09-02T10:05:00.000Z",
    };
    const admission = {
      admit: async () => {
        order.push("capacity-admission");
        return { outcome: "ADMITTED" as const };
      },
    };
    await new ManualExecutionUnitOfWork(source, admission).persistTransition(previous, next);
    expect(order).toEqual(["capacity-admission", "session-cas"]);
  });

  it("commits a denial result without executing the Session CAS", async () => {
    const order: string[] = [];
    const source = {
      query: async () => {
        order.push("session-cas");
        return [{ session_id: "s1" }];
      },
    };
    const planned = createSessionFixture({ id: "s1", ordinal: 1 });
    const previous = {
      ...planned,
      state: "READY" as const,
      resourceVersion: 2,
      readyAt: "2026-09-02T10:00:00.000Z",
    };
    const next = {
      ...previous,
      state: "RUNNING" as const,
      resourceVersion: 3,
      startedAt: "2026-09-02T10:05:00.000Z",
    };
    const decisionRef = {
      sourceType: "CAPACITY_ADMISSION_DECISION",
      sourceId: "denied",
      sourceVersion: 1,
      semanticHash: "sha256:denied",
    };
    const result = await new ManualExecutionUnitOfWork(source, {
      admit: async () => ({ outcome: "DENIED", decisionRef }),
    }).persistTransition(previous, next);
    expect(result).toEqual({ persisted: false, admission: { outcome: "DENIED", decisionRef } });
    expect(order).toEqual([]);
  });
});
