import { describe, expect, it, vi } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  transitionHumanWipClaim,
  transitionReviewCapacityReservation,
} from "../../../packages/platform-core/src/index.ts";
import { CapacityAdmissionRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { PostgresCapacityAdmissionBinder } from "../../../packages/runtime-composition/src/index.ts";

const base = { workspaceId: "w", projectId: "p", workItemId: "wi" } as const;

describe("US4 review reservation lifecycle", () => {
  it("holds one Work Item unit across multiple automated Sessions and converts atomically to review claim", () => {
    const first = transitionReviewCapacityReservation({
      ...base,
      reservationId: "r1",
      command: {
        kind: "ACQUIRE",
        sessionId: "s1",
        cause: "launch:s1",
        at: "2026-09-03T09:00:00Z",
        expiresAt: "2026-09-04T09:00:00Z",
        targetHasClaim: false,
      },
    });
    expect(first).toMatchObject({
      outcome: "APPENDED",
      committedDelta: 1,
      reservation: { state: "HELD", sessionIds: ["s1"] },
    });
    const replay = transitionReviewCapacityReservation({
      ...base,
      reservationId: "ignored-replay-id",
      current: first.reservation,
      command: {
        kind: "ACQUIRE",
        sessionId: "s1",
        cause: "launch:s1",
        at: "2026-09-03T09:00:00Z",
        expiresAt: "2026-09-04T09:00:00Z",
        targetHasClaim: false,
      },
    });
    expect(replay).toMatchObject({
      outcome: "NO_CHANGE",
      committedDelta: 0,
      reservation: { reservationId: "r1" },
    });
    const secondSession = transitionReviewCapacityReservation({
      ...base,
      reservationId: "r2",
      current: first.reservation,
      command: {
        kind: "ACQUIRE",
        sessionId: "s2",
        cause: "launch:s2",
        at: "2026-09-03T09:01:00Z",
        expiresAt: "2026-09-04T09:00:00Z",
        targetHasClaim: false,
      },
    });
    expect(secondSession).toMatchObject({
      committedDelta: 0,
      reservation: { state: "HELD", sessionIds: ["s1", "s2"] },
    });
    const converted = transitionReviewCapacityReservation({
      ...base,
      reservationId: "r3",
      current: secondSession.reservation,
      command: {
        kind: "CONVERT_TO_REVIEW_CLAIM",
        sessionId: "s2",
        cause: "result:review-required",
        at: "2026-09-03T10:00:00Z",
        targetHasClaim: false,
      },
    });
    expect(converted).toMatchObject({
      outcome: "APPENDED",
      committedDelta: 0,
      claimMutation: "CREATE",
      reservation: { state: "CONVERTED" },
    });
    expect(
      transitionReviewCapacityReservation({
        ...base,
        reservationId: "r4",
        current: converted.reservation,
        command: {
          kind: "CONVERT_TO_REVIEW_CLAIM",
          sessionId: "s2",
          cause: "result:review-required",
          at: "2026-09-03T10:00:00Z",
          targetHasClaim: false,
        },
      }),
    ).toMatchObject({ outcome: "NO_CHANGE" });
    const rerun = transitionReviewCapacityReservation({
      ...base,
      reservationId: "r4",
      current: converted.reservation,
      command: {
        kind: "ACQUIRE",
        sessionId: "s3",
        cause: "rerun:s3",
        at: "2026-09-03T11:00:00Z",
        expiresAt: "2026-09-04T11:00:00Z",
        targetHasClaim: true,
      },
    });
    expect(rerun).toMatchObject({
      outcome: "APPENDED",
      committedDelta: 0,
      reservation: { revision: 4, state: "COVERED_BY_CLAIM", reservedAt: "2026-09-03T11:00:00Z" },
    });
  });

  it("uses COVERED_BY_CLAIM without increasing committed union and merges the result cause", () => {
    const covered = transitionReviewCapacityReservation({
      ...base,
      reservationId: "covered-1",
      command: {
        kind: "ACQUIRE",
        sessionId: "s1",
        cause: "launch:s1",
        at: "2026-09-03T09:00:00Z",
        expiresAt: "2026-09-04T09:00:00Z",
        targetHasClaim: true,
      },
    });
    expect(covered).toMatchObject({
      committedDelta: 0,
      reservation: { state: "COVERED_BY_CLAIM" },
    });
    const converted = transitionReviewCapacityReservation({
      ...base,
      reservationId: "covered-2",
      current: covered.reservation,
      command: {
        kind: "CONVERT_TO_REVIEW_CLAIM",
        sessionId: "s1",
        cause: "result:review-required",
        at: "2026-09-03T10:00:00Z",
        targetHasClaim: true,
      },
    });
    expect(converted).toMatchObject({
      committedDelta: 0,
      claimMutation: "MERGE",
      reservation: { state: "CONVERTED" },
    });
  });

  it("releases a pre-review cancellation exactly once", () => {
    const held = transitionReviewCapacityReservation({
      ...base,
      reservationId: "cancel-1",
      command: {
        kind: "ACQUIRE",
        sessionId: "s1",
        cause: "launch:s1",
        at: "2026-09-03T09:00:00Z",
        expiresAt: "2026-09-04T09:00:00Z",
        targetHasClaim: false,
      },
    });
    const released = transitionReviewCapacityReservation({
      ...base,
      reservationId: "cancel-2",
      current: held.reservation,
      command: {
        kind: "RELEASE",
        sessionId: "s1",
        cause: "cancelled-before-review",
        at: "2026-09-03T09:30:00Z",
      },
    });
    expect(released).toMatchObject({
      committedDelta: -1,
      claimMutation: "NONE",
      reservation: { state: "RELEASED" },
    });
    expect(
      transitionReviewCapacityReservation({
        ...base,
        reservationId: "cancel-3",
        current: released.reservation,
        command: {
          kind: "RELEASE",
          sessionId: "s1",
          cause: "cancelled-before-review",
          at: "2026-09-03T09:30:00Z",
        },
      }),
    ).toMatchObject({ outcome: "NO_CHANGE", committedDelta: 0 });
  });

  it("materializes a terminal reservation witness when an authoritative result arrives without a launch reservation", () => {
    const converted = transitionReviewCapacityReservation({
      ...base,
      reservationId: "forced-result-1",
      command: {
        kind: "CONVERT_TO_REVIEW_CLAIM",
        sessionId: "s1",
        cause: "result-without-reservation",
        at: "2026-09-03T09:30:00.000Z",
        targetHasClaim: false,
      },
    });
    expect(converted).toMatchObject({
      outcome: "APPENDED",
      committedDelta: 1,
      claimMutation: "CREATE",
      reservation: { revision: 1, state: "CONVERTED", completedAt: "2026-09-03T09:30:00.000Z" },
    });
    expect(Date.parse(converted.reservation.expiresAt)).toBeGreaterThan(
      Date.parse(converted.reservation.reservedAt),
    );
  });

  it("appends claim release/reacquire history and persists predecessor CAS", async () => {
    const first = transitionHumanWipClaim({
      ...base,
      claimId: "c1",
      command: {
        kind: "UPSERT",
        sessionId: "s1",
        cause: "MANUAL_RUNNING",
        at: "2026-09-03T09:00:00Z",
      },
    });
    const released = transitionHumanWipClaim({
      ...base,
      claimId: "c2",
      current: first.claim,
      command: { kind: "RELEASE_BLOCK", cause: "HELD_BLOCK", at: "2026-09-03T09:30:00Z" },
    });
    const resumed = transitionHumanWipClaim({
      ...base,
      claimId: "c3",
      current: released.claim,
      command: {
        kind: "UPSERT",
        sessionId: "s1",
        cause: "MANUAL_RUNNING",
        at: "2026-09-03T10:00:00Z",
      },
    });
    expect([first.claim.state, released.claim.state, resumed.claim.state]).toEqual([
      "ACTIVE",
      "RELEASED_BLOCK",
      "ACTIVE",
    ]);
    const stored: { claim_id: string; revision_number: number; semantic_hash: string }[] = [];
    const manager = {
      query: async (sql: string, parameters: readonly unknown[]) => {
        if (sql.startsWith("SELECT semantic_hash"))
          return stored.filter(({ claim_id }) => claim_id === parameters[2]);
        if (sql.startsWith("SELECT claim_id,revision_number")) return stored.slice(-1);
        if (sql.includes("INSERT INTO work_item_human_wip_claims")) {
          stored.push({
            claim_id: String(parameters[0]),
            revision_number: Number(parameters[4]),
            semantic_hash: String(parameters[13]),
          });
          return [];
        }
        return [];
      },
    };
    const repository = new CapacityAdmissionRepository({} as never);
    const scope = { kind: "PROJECT" as const, workspaceId: "w", projectId: "p" };
    for (const revision of [first.claim, released.claim, resumed.claim])
      await repository.appendHumanWipClaimRevision(
        scope,
        revision,
        {
          sourceType: "TEST",
          sourceId: "source",
          sourceVersion: revision.revision,
          semanticHash: revision.semanticHash,
        },
        manager as never,
      );
    expect(stored.map(({ claim_id, revision_number }) => [claim_id, revision_number])).toEqual([
      ["c1", 1],
      ["c2", 2],
      ["c3", 3],
    ]);
    await expect(
      repository.appendHumanWipClaimRevision(
        scope,
        resumed.claim,
        { sourceType: "TEST" },
        manager as never,
      ),
    ).resolves.toMatchObject({ outcome: "DUPLICATE" });
  });

  it("converts the reservation, creates the review claim, advances capacity, and records the decision in one transaction", async () => {
    const at = "2026-09-03T10:00:00.000Z";
    const policyRef = {
      sourceId: "00000000-0000-4000-8000-000000000701",
      sourceVersion: 1,
      semanticHash: sha256("policy"),
    } as const;
    const facetRef = {
      id: "00000000-0000-4000-8000-000000000702",
      version: 1,
      semanticHash: sha256("facet"),
    } as const;
    const sessionContent = {
      id: "00000000-0000-4000-8000-000000000703",
      state: "RUNNING",
      resourceVersion: 2,
    } as const;
    const committedContent = {
      ...sessionContent,
      state: "REVIEW_REQUIRED",
      resourceVersion: 3,
    } as const;
    const sourceRef = {
      sourceType: "QA_TEST_SESSION_REVISION",
      sourceId: sessionContent.id,
      sourceVersion: 2,
      semanticHash: sha256(sessionContent as unknown as JsonValue),
    } as const;
    const heldCauses = ["automation-launch:session"] as const;
    const reservations: Record<string, unknown>[] = [
      {
        reservation_id: "00000000-0000-4000-8000-000000000704",
        revision_number: 1,
        previous_revision_id: null,
        workspace_id: "w",
        project_id: "p",
        work_item_id: "wi",
        session_ids: [sessionContent.id],
        state: "HELD",
        source_ref: sourceRef,
        cause_set: heldCauses,
        cause_set_hash: sha256(heldCauses as unknown as JsonValue),
        reserved_at: "2026-09-03T09:00:00.000Z",
        expires_at: "2026-09-04T09:00:00.000Z",
        completed_at: null,
        semantic_hash: sha256("held"),
      },
    ];
    const claims: Record<string, unknown>[] = [];
    const statements: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        statements.push(normalized);
        if (
          normalized.includes("FROM workspace_capacity_heads") &&
          normalized.includes("FOR UPDATE")
        )
          return [
            {
              state: "MEASURE_ONLY",
              resource_version: 1,
              human_occupied_count: 0,
              review_reserved_count: 1,
              human_committed_count: 1,
              forced_external_count: 0,
              active_expedite_count: 0,
              claim_set_hash: sha256([]),
              reservation_set_hash: sha256("before"),
              expedite_set_hash: sha256([]),
              policy_ref: policyRef,
            },
          ];
        if (normalized.includes("FROM work_item_queue_control_heads")) return [];
        if (normalized.includes("FROM qa_test_sessions") && normalized.includes("FOR UPDATE"))
          return [{ session_id: sessionContent.id, resource_version: 2, content: sessionContent }];
        if (normalized.includes("FROM capacity_admission_decisions")) return [];
        if (normalized.includes("FROM workspace_queue_policy_heads"))
          return [
            {
              mode: "MEASURE_ONLY",
              workspace_human_wip_limit: null,
              active_expedite_limit: null,
              project_entries: [{ projectId: "p", softWipLimit: null, reservedCapacity: null }],
            },
          ];
        if (normalized.includes("FROM project_queue_policy_facet_heads"))
          return [
            {
              policy_facet_id: facetRef.id,
              revision_number: 1,
              semantic_hash: facetRef.semanticHash,
            },
          ];
        if (normalized.startsWith("SELECT * FROM work_item_human_wip_claims"))
          return claims.slice(-1);
        if (normalized.startsWith("SELECT * FROM review_capacity_reservations"))
          return reservations.slice(-1);
        if (normalized.startsWith("WITH current_claims")) return [{ occupied: 0, reserved: 1 }];
        if (normalized.startsWith("SELECT semantic_hash FROM review_capacity_reservations"))
          return [];
        if (
          normalized.startsWith(
            "SELECT reservation_id,revision_number FROM review_capacity_reservations",
          )
        )
          return reservations.slice(-1).map((row) => ({
            reservation_id: row.reservation_id,
            revision_number: row.revision_number,
          }));
        if (normalized.startsWith("INSERT INTO review_capacity_reservations")) {
          reservations.push({
            reservation_id: parameters[0],
            revision_number: parameters[4],
            previous_revision_id: parameters[5],
            workspace_id: parameters[1],
            project_id: parameters[2],
            work_item_id: parameters[3],
            session_ids: JSON.parse(String(parameters[6])),
            state: parameters[7],
            source_ref: JSON.parse(String(parameters[8])),
            cause_set: JSON.parse(String(parameters[9])),
            cause_set_hash: parameters[10],
            reserved_at: parameters[11],
            expires_at: parameters[12],
            completed_at: parameters[13],
            semantic_hash: parameters[14],
          });
          return [];
        }
        if (normalized.startsWith("SELECT semantic_hash FROM work_item_human_wip_claims"))
          return [];
        if (
          normalized.startsWith("SELECT claim_id,revision_number FROM work_item_human_wip_claims")
        )
          return [];
        if (normalized.startsWith("INSERT INTO work_item_human_wip_claims")) {
          claims.push({
            claim_id: parameters[0],
            revision_number: parameters[4],
            previous_revision_id: parameters[5],
            workspace_id: parameters[1],
            project_id: parameters[2],
            work_item_id: parameters[3],
            session_ids: JSON.parse(String(parameters[6])),
            state: parameters[7],
            source_ref: JSON.parse(String(parameters[8])),
            cause_set: JSON.parse(String(parameters[9])),
            cause_set_hash: parameters[10],
            acquired_at: parameters[11],
            released_at: parameters[12],
            semantic_hash: parameters[13],
          });
          return [];
        }
        if (normalized.includes("current_claims WHERE state='ACTIVE'")) return claims.slice(-1);
        if (normalized.includes("current_reservations ORDER BY")) return reservations.slice(-1);
        if (normalized.includes("revision.service_class='EXPEDITE'")) return [];
        if (normalized.startsWith("UPDATE workspace_capacity_heads"))
          return [{ resource_version: 2 }];
        return [];
      }),
    };
    const source = { transaction: vi.fn() };
    const binder = new PostgresCapacityAdmissionBinder(source as never, {
      reauthorize: vi.fn().mockResolvedValue(true),
    });
    const receipt = await binder.admitInTransaction(manager as never, {
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      sessionId: sessionContent.id,
      principalId: "worker",
      requestKey: "automation-result-convert-0001",
      activityKind: "AUTOMATED_RESULT_APPLY",
      automatedResultPath: "CONVERT_RESERVATION_TO_REVIEW_CLAIM",
      actor: { kind: "SERVICE", serviceId: "worker" },
      authorizationScopeWitnessHash: sha256("authorized"),
      expectedState: {
        policyFacetRef: facetRef,
        expectedQueueControlVersion: 0,
        operationalProjectionRef: {
          sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
          sourceId: "op",
          sourceVersion: 1,
          semanticHash: sha256("op"),
        },
        qaSourceSetHash: sha256("qa"),
        sessionRef: sourceRef,
      },
      committedSessionRef: {
        ...sourceRef,
        sourceVersion: 3,
        semanticHash: sha256(committedContent as unknown as JsonValue),
      },
      authorizedScopeSnapshotRef: {
        id: "00000000-0000-4000-8000-000000000705",
        version: 1,
        semanticHash: sha256("authorized-snapshot"),
      },
      decidedAt: at,
      correlationId: "00000000-0000-4000-8000-000000000706",
      causationId: "00000000-0000-4000-8000-000000000707",
    });
    expect(receipt).toMatchObject({ outcome: "NON_DISCRETIONARY_APPLIED", replayed: false });
    expect(receipt.mutationRefs.map(({ sourceType }) => sourceType).sort()).toEqual([
      "HUMAN_WIP_CLAIM_REVISION",
      "QA_TEST_SESSION_REVISION",
      "REVIEW_CAPACITY_RESERVATION_REVISION",
    ]);
    expect(reservations.at(-1)?.state).toBe("CONVERTED");
    expect(claims.at(-1)?.state).toBe("ACTIVE");
    expect(
      statements.findIndex(
        (sql) => sql.includes("workspace_capacity_heads") && sql.includes("FOR UPDATE"),
      ),
    ).toBeLessThan(statements.findIndex((sql) => sql.includes("work_item_queue_control_heads")));
    expect(
      statements.findIndex((sql) => sql.includes("work_item_queue_control_heads")),
    ).toBeLessThan(
      statements.findIndex((sql) => sql.includes("qa_test_sessions") && sql.includes("FOR UPDATE")),
    );
    expect(
      statements.some((sql) => sql.startsWith("INSERT INTO capacity_admission_decisions")),
    ).toBe(true);
    expect(statements.filter((sql) => sql.startsWith("INSERT INTO event_outbox"))).toHaveLength(2);
  });
});
