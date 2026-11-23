import { describe, expect, it, vi } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  type SlaClockSegmentRevision,
  type SlaClockTransition,
} from "../../../packages/platform-core/src/index.ts";
import { SlaClockRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { businessCalendarFixture, policyIds } from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

type Row = Record<string, unknown>;
const id = (suffix: string): string => `62000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const jira = (version: number, confirmedAt: string) =>
  Object.freeze({
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
    sourceId: id(`1${version}`),
    sourceVersion: version,
    semanticHash: digest(`jira:${version}`),
    confirmedAt,
  });

function clockFixture() {
  const calendar = businessCalendarFixture({ timeZone: "UTC" });
  const transition = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: id("2"),
    slaClockId: id("3"),
    goal: "READY_TO_FIRST_QA_START",
    policyFacetRef: { id: id("4"), version: 1, semanticHash: digest("policy-facet") },
    calendarRef: {
      id: calendar.calendarId,
      version: calendar.revision,
      semanticHash: calendar.semanticHash,
    },
    mappingRef: {
      sourceType: "JIRA_STATUS_MAPPING_REVISION",
      sourceId: id("5"),
      sourceVersion: 1,
      semanticHash: digest("mapping"),
    },
    algorithmRef: { key: "sla-clock", version: "1.0.0", semanticHash: digest("sla-clock") },
    startSourceRef: jira(1, "2026-09-07T09:00:00.000Z"),
  });
  return { calendar, transition };
}

function persistenceHarness() {
  let clockHead: Row | undefined;
  const clockRevisions: Row[] = [];
  const segmentHeads = new Map<string, Row>();
  const segmentRevisions: Row[] = [];
  const thresholdEmissions: Row[] = [];
  const statements: string[] = [];

  const manager = {
    query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
      const normalized = sql.replace(/\s+/gu, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT head.*, revision.public_transition")) {
        if (!clockHead) return [];
        const revision = clockRevisions.find(
          (candidate) => candidate.sla_clock_revision_id === clockHead?.current_revision_id,
        );
        return [{ ...clockHead, ...revision }];
      }
      if (normalized.startsWith("SELECT semantic_hash FROM sla_clock_revisions")) {
        return clockRevisions.filter(
          (candidate) =>
            candidate.sla_clock_id === parameters[2] && candidate.revision_number === parameters[3],
        );
      }
      if (normalized.startsWith("SELECT MAX((public_transition")) {
        const versions = clockRevisions
          .map((candidate) => candidate.public_transition as SlaClockTransition)
          .filter(
            ({ transitionSourceRef }) =>
              transitionSourceRef.sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION",
          )
          .map(({ transitionSourceRef }) => Number(transitionSourceRef.sourceVersion));
        return [{ source_version: versions.length === 0 ? null : Math.max(...versions) }];
      }
      if (normalized.startsWith("INSERT INTO sla_clock_heads")) {
        clockHead = {
          sla_clock_id: parameters[0],
          workspace_id: parameters[1],
          project_id: parameters[2],
          work_item_id: parameters[3],
          goal: parameters[4],
          current_revision_id: parameters[5],
          resource_version: 1,
          current_clock_cycle: parameters[6],
          next_temporal_evaluation_at: parameters[7],
          created_at: parameters[8],
          updated_at: parameters[8],
        };
        return [];
      }
      if (normalized.startsWith("INSERT INTO sla_clock_revisions")) {
        clockRevisions.push({
          sla_clock_revision_id: parameters[0],
          sla_clock_id: parameters[1],
          workspace_id: parameters[2],
          project_id: parameters[3],
          revision_number: parameters[4],
          previous_revision_id: parameters[5],
          transition_kind: parameters[6],
          state: parameters[7],
          goal: parameters[8],
          clock_cycle: parameters[9],
          calendar_ref: JSON.parse(String(parameters[10])),
          policy_ref: JSON.parse(String(parameters[11])),
          start_source_ref: JSON.parse(String(parameters[12])),
          transition_source_ref: JSON.parse(String(parameters[13])),
          target_business_seconds: parameters[14],
          warning_thresholds: JSON.parse(String(parameters[15])),
          accumulated_business_seconds: parameters[16],
          last_started_at: parameters[17],
          stopped_at: parameters[18],
          public_transition: JSON.parse(String(parameters[19])),
          input_fingerprint: parameters[20],
          semantic_hash: parameters[21],
          recorded_at: parameters[22],
        });
        return [];
      }
      if (
        normalized.startsWith("SELECT head.*, revision.*") &&
        normalized.includes("sla_clock_segment_heads")
      ) {
        const open = [...segmentHeads.values()].find(
          (candidate) => candidate.sla_clock_id === parameters[2] && candidate.is_open === true,
        );
        if (!open) return [];
        const revision = segmentRevisions.find(
          (candidate) => candidate.segment_revision_id === open.current_revision_id,
        );
        return [{ ...open, ...revision }];
      }
      if (normalized.startsWith("SELECT COALESCE(MAX(ordinal)")) {
        const ordinals = [...segmentHeads.values()]
          .filter((candidate) => candidate.sla_clock_id === parameters[2])
          .map((candidate) => Number(candidate.ordinal));
        return [{ ordinal: ordinals.length === 0 ? 0 : Math.max(...ordinals) }];
      }
      if (normalized.startsWith("INSERT INTO sla_clock_segment_heads")) {
        segmentHeads.set(String(parameters[0]), {
          segment_id: parameters[0],
          sla_clock_id: parameters[1],
          workspace_id: parameters[2],
          project_id: parameters[3],
          clock_cycle: parameters[4],
          ordinal: parameters[5],
          state: parameters[6],
          current_revision_id: parameters[7],
          resource_version: 1,
          is_open: true,
          created_at: parameters[8],
          updated_at: parameters[8],
        });
        return [];
      }
      if (normalized.startsWith("INSERT INTO sla_clock_segments")) {
        segmentRevisions.push(
          parameters.length === 16
            ? {
                segment_revision_id: parameters[0],
                segment_id: parameters[1],
                sla_clock_id: parameters[2],
                workspace_id: parameters[3],
                project_id: parameters[4],
                revision_number: parameters[5],
                previous_revision_id: parameters[6],
                clock_cycle: parameters[7],
                ordinal: parameters[8],
                state: parameters[9],
                started_at: parameters[10],
                ended_at: parameters[11],
                start_revision_id: parameters[12],
                end_revision_id: parameters[13],
                business_seconds: parameters[14],
                semantic_hash: parameters[15],
              }
            : {
                segment_revision_id: parameters[0],
                segment_id: parameters[1],
                sla_clock_id: parameters[2],
                workspace_id: parameters[3],
                project_id: parameters[4],
                revision_number: 1,
                previous_revision_id: null,
                clock_cycle: parameters[5],
                ordinal: parameters[6],
                state: parameters[7],
                started_at: parameters[8],
                ended_at: null,
                start_revision_id: parameters[9],
                end_revision_id: null,
                business_seconds: 0,
                semantic_hash: parameters[10],
              },
        );
        return [];
      }
      if (normalized.startsWith("UPDATE sla_clock_segment_heads")) {
        const head = segmentHeads.get(String(parameters[5]));
        if (!head || head.resource_version !== parameters[6] || head.is_open !== true) return [];
        Object.assign(head, {
          current_revision_id: parameters[0],
          resource_version: parameters[1],
          is_open: false,
          updated_at: parameters[2],
        });
        return [{ segment_id: parameters[5] }];
      }
      if (
        normalized.startsWith("UPDATE sla_clock_heads") &&
        normalized.includes("current_revision_id")
      ) {
        if (!clockHead || clockHead.resource_version !== parameters[8]) return [];
        Object.assign(clockHead, {
          current_revision_id: parameters[0],
          resource_version: parameters[1],
          current_clock_cycle: parameters[2],
          next_temporal_evaluation_at: parameters[3],
          updated_at: parameters[4],
        });
        return [{ sla_clock_id: clockHead.sla_clock_id }];
      }
      if (normalized.startsWith("SELECT public_transition FROM sla_clock_revisions")) {
        return clockRevisions.filter(
          (candidate) =>
            candidate.sla_clock_id === parameters[2] && candidate.revision_number === parameters[3],
        );
      }
      if (normalized.startsWith("SELECT semantic_hash FROM sla_threshold_emissions")) {
        return thresholdEmissions.filter(
          (candidate) =>
            candidate.sla_clock_id === parameters[2] &&
            candidate.clock_cycle === parameters[3] &&
            candidate.policy_facet_hash === parameters[4] &&
            candidate.threshold_kind === parameters[5] &&
            candidate.threshold_key === parameters[6],
        );
      }
      if (normalized.startsWith("INSERT INTO sla_threshold_emissions")) {
        thresholdEmissions.push({
          emission_id: parameters[0],
          workspace_id: parameters[1],
          project_id: parameters[2],
          sla_clock_id: parameters[3],
          clock_cycle: parameters[4],
          policy_facet_hash: parameters[5],
          clock_revision_ref: JSON.parse(String(parameters[6])),
          threshold_key: parameters[7],
          threshold_kind: parameters[8],
          reached_at: parameters[9],
          payload: JSON.parse(String(parameters[12])),
          semantic_hash: parameters[13],
        });
        return [];
      }
      return [];
    }),
  };
  const source = {
    transaction: vi.fn(
      async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
        await work(manager),
    ),
    query: manager.query,
  };
  return {
    repository: new SlaClockRepository(source as never),
    statements,
    clockRevisions,
    segmentHeads,
    segmentRevisions,
    thresholdEmissions,
    head: () => clockHead,
  };
}

function segmentInput(revisionId: string, value: SlaClockSegmentRevision) {
  return { revisionId, value } as const;
}

function rehashTransition(
  value: SlaClockTransition,
  overrides: Readonly<Record<string, unknown>>,
): SlaClockTransition {
  const { clockRevisionRef, ...body } = value;
  const changed = { ...body, ...overrides };
  return Object.freeze({
    ...changed,
    clockRevisionRef: Object.freeze({
      ...clockRevisionRef,
      semanticHash: sha256(changed as unknown as JsonValue),
    }),
  }) as SlaClockTransition;
}

describe("US5 append-only SLA persistence", () => {
  it("appends exact clock/segment lineage, preserves old rows, and reopens under the same cycle-safe head", async () => {
    const { calendar, transition: started } = clockFixture();
    const store = persistenceHarness();
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: started.workspaceId,
      projectId: started.projectId,
    };
    const initialOpen = applySlaClockTransitionToSegments({
      transition: started,
      calendar,
      nextSegmentId: id("20"),
    }).opened!;
    await expect(
      store.repository.startInitial({
        scope,
        transition: started,
        revisionId: id("30"),
        segmentId: initialOpen.segmentRef.sourceId,
        targetBusinessSeconds: 28_800,
        warningThresholds: [{ key: "AT_RISK", elapsedBusinessSeconds: 14_400 }],
        correlationId: id("31"),
        causationId: id("32"),
      }),
    ).resolves.toEqual({ outcome: "STARTED", revision: 1 });
    await expect(
      store.repository.startInitial({
        scope,
        transition: started,
        revisionId: id("30"),
        segmentId: initialOpen.segmentRef.sourceId,
        targetBusinessSeconds: 28_800,
        warningThresholds: [{ key: "AT_RISK", elapsedBusinessSeconds: 14_400 }],
        correlationId: id("31"),
        causationId: id("32"),
      }),
    ).resolves.toEqual({ outcome: "NO_OP_DUPLICATE", revision: 1 });

    const paused = advanceSlaClock({
      current: started,
      calendar,
      command: {
        kind: "PAUSE",
        sourceRef: jira(2, "2026-09-07T12:00:00.000Z"),
        mappedPauseReasonCode: "WAITING_EXTERNAL",
      },
    });
    if (paused.outcome !== "APPENDED") throw new Error("expected pause");
    const pauseSegments = applySlaClockTransitionToSegments({
      transition: paused.transition,
      calendar,
      openSegment: initialOpen,
      nextSegmentId: id("21"),
    });
    await store.repository.appendTransition({
      scope,
      transition: paused.transition,
      revisionId: id("33"),
      expectedVersion: 1,
      closedSegment: segmentInput(id("40"), pauseSegments.closed!),
      openedSegment: segmentInput(id("41"), pauseSegments.opened!),
    });

    const stopped = advanceSlaClock({
      current: paused.transition,
      calendar,
      command: {
        kind: "STOP",
        sourceRef: {
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("50"),
          sourceVersion: 1,
          semanticHash: digest("session"),
        },
        effectiveAt: "2026-09-08T12:00:00.000Z",
      },
    });
    if (stopped.outcome !== "APPENDED") throw new Error("expected stop");
    const stopSegments = applySlaClockTransitionToSegments({
      transition: stopped.transition,
      calendar,
      openSegment: pauseSegments.opened!,
    });
    await store.repository.appendTransition({
      scope,
      transition: stopped.transition,
      revisionId: id("34"),
      expectedVersion: 2,
      closedSegment: segmentInput(id("42"), stopSegments.closed!),
    });

    const reopened = advanceSlaClock({
      current: stopped.transition,
      calendar,
      command: { kind: "REOPEN", sourceRef: jira(4, "2026-09-14T09:00:00.000Z") },
    });
    if (reopened.outcome !== "APPENDED") throw new Error("expected reopen");
    const reopenSegments = applySlaClockTransitionToSegments({
      transition: reopened.transition,
      calendar,
      nextSegmentId: id("22"),
      previousOrdinal: 2,
    });
    await store.repository.appendTransition({
      scope,
      transition: reopened.transition,
      revisionId: id("35"),
      expectedVersion: 3,
      openedSegment: segmentInput(id("43"), reopenSegments.opened!),
    });

    expect(
      store.clockRevisions.map(({ revision_number, clock_cycle, state }) => [
        revision_number,
        clock_cycle,
        state,
      ]),
    ).toEqual([
      [1, 1, "RUNNING"],
      [2, 1, "PAUSED"],
      [3, 1, "STOPPED"],
      [4, 2, "RUNNING"],
    ]);
    expect(
      store.segmentRevisions.map(({ segment_id, revision_number }) => [
        segment_id,
        revision_number,
      ]),
    ).toEqual([
      [id("20"), 1],
      [id("20"), 2],
      [id("21"), 1],
      [id("21"), 2],
      [id("22"), 1],
    ]);
    expect([...store.segmentHeads.values()].filter(({ is_open }) => is_open)).toHaveLength(1);
    expect(store.head()).toMatchObject({ resource_version: 4, current_clock_cycle: 2 });
    expect(
      store.statements.some((statement) =>
        /^UPDATE sla_clock_(revisions|segments)\b/u.test(statement),
      ),
    ).toBe(false);
  });

  it("emits one immutable threshold fact per cycle, policy, kind and key", async () => {
    const { transition } = clockFixture();
    const store = persistenceHarness();
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: transition.workspaceId,
      projectId: transition.projectId,
    };
    await store.repository.startInitial({
      scope,
      transition,
      revisionId: id("60"),
      segmentId: id("61"),
      targetBusinessSeconds: 28_800,
      warningThresholds: [{ key: "AT_RISK", elapsedBusinessSeconds: 14_400 }],
      correlationId: id("62"),
      causationId: id("63"),
    });
    const payload = {
      schemaVersion: "sla-threshold-emission@1.0.0",
      threshold: "AT_RISK",
    } as unknown as JsonValue;
    const request = {
      scope,
      emissionId: id("64"),
      slaClockId: transition.slaClockId,
      clockCycle: 1,
      policyFacetRef: transition.policyFacetRef,
      clockRevisionRef: transition.clockRevisionRef,
      thresholdKey: "AT_RISK",
      thresholdKind: "WARNING" as const,
      reachedAt: "2026-09-08T12:00:00.000Z",
      payload,
    };
    await expect(store.repository.appendThresholdEmission(request)).resolves.toEqual({
      outcome: "APPENDED",
    });
    await expect(store.repository.appendThresholdEmission(request)).resolves.toEqual({
      outcome: "NO_OP_DUPLICATE",
    });
    await expect(
      store.repository.appendThresholdEmission({ ...request, payload: { changed: true } }),
    ).rejects.toThrow("SLA_THRESHOLD_REPLAY_CONFLICT");
    expect(store.thresholdEmissions).toHaveLength(1);
    expect(store.thresholdEmissions[0]?.semantic_hash).toBe(sha256(payload));
  });

  it("rejects changed pins, non-monotonic Jira facts, and a goal-incompatible stop source", async () => {
    const { calendar, transition: started } = clockFixture();
    const store = persistenceHarness();
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: started.workspaceId,
      projectId: started.projectId,
    };
    await store.repository.startInitial({
      scope,
      transition: started,
      revisionId: id("80"),
      segmentId: id("81"),
      targetBusinessSeconds: 28_800,
      warningThresholds: [{ key: "AT_RISK", elapsedBusinessSeconds: 14_400 }],
      correlationId: id("82"),
      causationId: id("83"),
    });
    const paused = advanceSlaClock({
      current: started,
      calendar,
      command: {
        kind: "PAUSE",
        sourceRef: jira(2, "2026-09-07T12:00:00.000Z"),
        mappedPauseReasonCode: "WAITING_EXTERNAL",
      },
    });
    if (paused.outcome !== "APPENDED") throw new Error("expected pause");
    const changedPolicy = rehashTransition(paused.transition, {
      policyFacetRef: {
        ...paused.transition.policyFacetRef,
        semanticHash: digest("different-policy"),
      },
    });
    await expect(
      store.repository.appendTransition({
        scope,
        transition: changedPolicy,
        revisionId: id("84"),
        expectedVersion: 1,
      }),
    ).rejects.toThrow("SLA_CLOCK_LINEAGE_INVALID");
    const changedCalendar = rehashTransition(paused.transition, {
      calendarRef: { ...paused.transition.calendarRef, semanticHash: digest("different-calendar") },
    });
    await expect(
      store.repository.appendTransition({
        scope,
        transition: changedCalendar,
        revisionId: id("85"),
        expectedVersion: 1,
      }),
    ).rejects.toThrow("SLA_CLOCK_LINEAGE_INVALID");

    const staleSource = jira(1, "2026-09-07T09:00:00.000Z");
    const staleFingerprint = sha256({
      previousClockRevisionRef: started.clockRevisionRef,
      transition: "PAUSE",
      transitionSourceRef: staleSource,
      mappedPauseReasonCode: "WAITING_EXTERNAL",
    } as unknown as JsonValue);
    const stalePause = rehashTransition(paused.transition, {
      transitionSourceRef: staleSource,
      effectiveAt: staleSource.confirmedAt,
      inputFingerprint: staleFingerprint,
    });
    await expect(
      store.repository.appendTransition({
        scope,
        transition: stalePause,
        revisionId: id("86"),
        expectedVersion: 1,
      }),
    ).rejects.toThrow("SLA_CLOCK_JIRA_SOURCE_NON_MONOTONIC");

    const stopped = advanceSlaClock({
      current: started,
      calendar,
      command: {
        kind: "STOP",
        sourceRef: {
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("87"),
          sourceVersion: 1,
          semanticHash: digest("session-stop"),
        },
        effectiveAt: "2026-09-07T12:00:00.000Z",
      },
    });
    if (stopped.outcome !== "APPENDED") throw new Error("expected stop");
    const wrongSource = {
      sourceType: "QA_VERDICT_REVISION" as const,
      sourceId: id("88"),
      sourceVersion: 1,
      semanticHash: digest("verdict-stop"),
    };
    const wrongFingerprint = sha256({
      previousClockRevisionRef: started.clockRevisionRef,
      transition: "STOP",
      transitionSourceRef: wrongSource,
    } as unknown as JsonValue);
    const wrongStop = rehashTransition(stopped.transition, {
      transitionSourceRef: wrongSource,
      inputFingerprint: wrongFingerprint,
    });
    await expect(
      store.repository.appendTransition({
        scope,
        transition: wrongStop,
        revisionId: id("89"),
        expectedVersion: 1,
      }),
    ).rejects.toThrow("SLA_CLOCK_STOP_SOURCE_GOAL_MISMATCH");
  });

  it("uses bounded SKIP LOCKED leases without rewriting the authoritative deadline", async () => {
    const dueAt = "2026-09-08T12:00:00.000Z";
    const query = vi.fn().mockResolvedValue([
      {
        workspace_id: policyIds.workspace,
        project_id: policyIds.projectA,
        sla_clock_id: id("70"),
        due_at: dueAt,
      },
    ]);
    const repository = new SlaClockRepository({ query } as never);
    const claimed = await repository.claimDueClocks({
      scope: { kind: "WORKSPACE", workspaceId: policyIds.workspace },
      dueBefore: dueAt,
      limit: 10,
      leaseMilliseconds: 60_000,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ dueAt, claimedUntil: "2026-09-08T12:01:00.000Z" });
    const statement = String(query.mock.calls[0]?.[0]).replace(/\s+/gu, " ");
    expect(statement).toContain("FOR UPDATE SKIP LOCKED");
    expect(statement).toContain("temporal_claim_token");
    expect(statement).not.toContain("SET next_temporal_evaluation_at");
  });
});
