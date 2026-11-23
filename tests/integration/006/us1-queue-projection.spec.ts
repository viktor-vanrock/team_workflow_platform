import { describe, expect, it, vi } from "vitest";

import { TypeOrmOperationalAuthorityRepository } from "../../../packages/platform-persistence-typeorm/src/operational-authority.repository.ts";
import {
  queueProjectionReadState,
  QueueProjectionRebuildCoordinator,
} from "../../../packages/runtime-composition/src/queue/projection-rebuild.ts";
import {
  boundedQueueProjectionCause,
  LocalQueueFactComposer,
  QueueProjectionCoordinator,
  queueProjectionEventTypes,
  queueProjectionInputFingerprint,
} from "../../../packages/runtime-composition/src/queue/projection-worker.ts";

const scope = { workspaceId: "w1", projectId: "p1" };

describe("US1 queue projection coordinator", () => {
  it("queries the immutable confirmed authority revision rather than Work Item state", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        work_item_id: "item-1",
        work_type_key: "qa-validation",
        definition_version: "1.3.0",
        workspace_id: "w1",
        project_id: "p1",
        freshness_state: "CURRENT",
        projection_id: "projection-1",
        revision: 4,
        authority_fields_hash: `sha256:${"b".repeat(64)}`,
        external_revision_token: "jira-9",
        observed_at: "2026-09-02T10:00:00.000Z",
        applied_at: "2026-09-02T10:00:01.000Z",
        configuration_refs: { mappingRef: { id: "mapping-1", version: 3 } },
        authority_snapshot: { normalizedStatus: "READY", rawStatus: { id: "100", name: "Ready" } },
      },
    ]);
    const repository = new TypeOrmOperationalAuthorityRepository({ query } as never);
    await expect(repository.confirmedProjectionForWorkItem(scope, "item-1")).resolves.toMatchObject(
      {
        projectionId: "projection-1",
        revision: 4,
        snapshot: { normalizedStatus: "READY" },
      },
    );
    const sql = String(query.mock.calls[0]![0]);
    expect(sql).toContain("operational_projection_revisions");
    expect(sql).not.toMatch(/\bw\.state\b/u);
  });

  it("composes stage facts from local ports and never exposes a provider read", async () => {
    const ref = (sourceType: string, sourceId: string, sourceVersion: number, digit: string) => ({
      sourceType,
      sourceId,
      sourceVersion,
      semanticHash: `sha256:${digit.repeat(64)}` as const,
    });
    const ports = {
      workItem: {
        current: vi.fn().mockResolvedValue({
          subject: {
            kind: "WORK_ITEM",
            id: "item-1",
            version: 2,
            semanticHash: `sha256:${"1".repeat(64)}` as const,
          },
          sourceRefs: [ref("WORK_ITEM_REVISION", "item-1", 2, "1")],
        }),
      },
      operational: {
        current: vi.fn().mockResolvedValue({
          state: "KNOWN",
          normalizedStatus: "READY",
          displayStatus: "Ready",
          sourceRefs: [ref("JIRA_OPERATIONAL_PROJECTION_REVISION", "op-1", 3, "2")],
        }),
      },
      qa: {
        current: vi.fn().mockResolvedValue({
          state: "KNOWN",
          readiness: "READY",
          activities: [],
          sourceRefs: [ref("QA_QUEUE_FACT_REVISION", "qa-1", 1, "3")],
        }),
      },
      planning: {
        current: vi.fn().mockResolvedValue({
          policyFacetRef: {
            id: "00000000-0000-4000-8000-000000000004",
            version: 1,
            semanticHash: `sha256:${"4".repeat(64)}` as const,
          },
          derivationRuleRef: {
            key: "queue-stage",
            version: "1.0.0",
            semanticHash: `sha256:${"5".repeat(64)}` as const,
          },
          control: { state: "DEFAULT", resourceVersion: 0, serviceClass: "STANDARD" },
          capacity: { state: "NOT_CONSUMING" },
          sla: { state: "NOT_APPLICABLE" },
          ordering: { state: "NOT_APPLICABLE" },
          sourceRefs: [],
        }),
      },
    };
    const composer = new LocalQueueFactComposer(ports);
    await expect(composer.readCurrent({ ...scope, subjectId: "item-1" })).resolves.toMatchObject({
      subjectId: "item-1",
      stage: "READY",
      sourceRefs: expect.arrayContaining([expect.objectContaining({ sourceId: "op-1" })]),
    });
    expect(Object.keys(ports)).not.toContain("provider");
  });

  it("bounds corrections and keeps projection/control emissions mutually exclusive", () => {
    expect(
      boundedQueueProjectionCause({ kind: "CORRECTION", reasonCode: "AUTHORITY_RECONCILED" }),
    ).toEqual({ kind: "CORRECTION", reasonCode: "AUTHORITY_RECONCILED" });
    expect(() => boundedQueueProjectionCause({ kind: "CORRECTION" })).toThrow(
      "QUEUE_CORRECTION_REASON_REQUIRED",
    );
    expect(queueProjectionEventTypes({ controlTransition: false, stageChanged: true })).toEqual([
      "queue.projection.updated",
      "queue.stage.changed",
    ]);
    expect(queueProjectionEventTypes({ controlTransition: true, stageChanged: false })).toEqual([
      "queue.control.changed",
    ]);
  });

  it("checkpoints a shadow rebuild, catches up, validates, then atomically activates", async () => {
    const store = {
      begin: vi
        .fn()
        .mockResolvedValue({ generationId: "shadow-1", highWatermarks: { eventOutbox: "10" } }),
      page: vi
        .fn()
        .mockResolvedValueOnce({
          subjects: [{ ...scope, subjectId: "item-1" }],
          nextCursor: "p1:item-1",
        })
        .mockResolvedValueOnce({ subjects: [], nextCursor: undefined }),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      catchUp: vi.fn().mockResolvedValue([{ ...scope, subjectId: "item-1" }]),
      validate: vi.fn().mockResolvedValue({
        valid: true,
        subjectCount: 1,
        stageCounts: { READY: 1 },
        outputSetHash: `sha256:${"7".repeat(64)}`,
      }),
      activate: vi.fn().mockResolvedValue({ corrections: 1 }),
      fail: vi.fn(),
    };
    const projector = { rebuild: vi.fn().mockResolvedValue(undefined) };
    const rebuild = new QueueProjectionRebuildCoordinator(store, projector);
    await expect(rebuild.run("w1", 50)).resolves.toMatchObject({
      generationId: "shadow-1",
      corrections: 1,
    });
    expect(projector.rebuild).toHaveBeenNthCalledWith(
      1,
      [{ ...scope, subjectId: "item-1" }],
      "shadow-1",
    );
    expect(store.checkpoint).toHaveBeenCalledWith("shadow-1", "p1:item-1", 1);
    expect(store.activate).toHaveBeenCalledAfter(store.validate);
  });

  it("exposes rebuilding only while a shadow generation is live", () => {
    expect(queueProjectionReadState([{ state: "ACTIVE" }, { state: "BUILDING" }])).toBe(
      "REBUILDING",
    );
    expect(queueProjectionReadState([{ state: "ACTIVE" }])).toBe("CURRENT");
  });

  it("dedupes and ignores older invalidations before exact local reread/append", async () => {
    const readCurrent = vi.fn().mockResolvedValue({
      subjectId: "item-1",
      sourceRefs: [
        {
          sourceType: "WORK_ITEM_REVISION",
          sourceId: "item-1",
          sourceVersion: 2,
          semanticHash: `sha256:${"a".repeat(64)}` as const,
        },
      ],
    });
    const appendIfChanged = vi.fn().mockResolvedValue({ changed: true, revisionNumber: 1 });
    const coordinator = new QueueProjectionCoordinator({
      readCurrent,
      appendIfChanged,
      suppressPrecursor: vi.fn(),
    });
    const event = { eventId: "e2", entityId: "item-1", entityVersion: 2, scope };
    await expect(coordinator.consume(event)).resolves.toMatchObject({ status: "PROCESSED" });
    await expect(coordinator.consume(event)).resolves.toMatchObject({ status: "DUPLICATE" });
    await expect(
      coordinator.consume({ ...event, eventId: "e1", entityVersion: 1 }),
    ).resolves.toMatchObject({ status: "STALE" });
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(appendIfChanged).toHaveBeenCalledTimes(1);
  });

  it("does not let import or Jira counters suppress updates from another source", async () => {
    const readCurrent = vi.fn().mockResolvedValue({ subjectId: "item-1", sourceRefs: [] });
    const coordinator = new QueueProjectionCoordinator({
      readCurrent,
      appendIfChanged: vi.fn().mockResolvedValue({ changed: true, revisionNumber: 1 }),
      suppressPrecursor: vi.fn(),
    });
    for (const [eventType, entityVersion] of [
      ["work_item.operational.imported", 1_700_000_000_000],
      ["work_item.operational.projection-updated", 2],
      ["qa.queue-facts.changed", 1],
    ] as const) {
      await expect(
        coordinator.consume({
          eventId: eventType,
          eventType,
          entityId: "item-1",
          entityVersion,
          scope,
        }),
      ).resolves.toMatchObject({ status: "PROCESSED" });
    }
    expect(readCurrent).toHaveBeenCalledTimes(3);
  });

  it("uses the same semantic input fingerprint for ordinary and shadow rebuild", async () => {
    const value = {
      subjectId: "item-1",
      sourceRefs: [
        {
          sourceType: "WORK_ITEM_REVISION",
          sourceId: "item-1",
          sourceVersion: 2,
          semanticHash: `sha256:${"a".repeat(64)}` as const,
        },
      ],
    };
    const appendIfChanged = vi.fn().mockResolvedValue({ changed: false, revisionNumber: 3 });
    const coordinator = new QueueProjectionCoordinator({
      readCurrent: vi.fn().mockResolvedValue(value),
      appendIfChanged,
      suppressPrecursor: vi.fn(),
    });
    await coordinator.rebuild([{ ...scope, subjectId: "item-1" }], "shadow-1");
    expect(appendIfChanged.mock.calls[0]![0]).toMatchObject({
      generationId: "shadow-1",
      inputFingerprint: queueProjectionInputFingerprint(value),
    });
  });

  it("suppresses a Candidate/Draft precursor in the same projector transaction", async () => {
    const suppressPrecursor = vi.fn().mockResolvedValue(undefined);
    const coordinator = new QueueProjectionCoordinator({
      readCurrent: vi
        .fn()
        .mockResolvedValue({ subjectId: "item-1", precursorId: "candidate-1", sourceRefs: [] }),
      appendIfChanged: vi.fn().mockResolvedValue({ changed: true, revisionNumber: 1 }),
      suppressPrecursor,
    });
    await coordinator.consume({ eventId: "e1", entityId: "item-1", entityVersion: 1, scope });
    expect(suppressPrecursor).toHaveBeenCalledWith(
      expect.objectContaining({ precursorId: "candidate-1", workItemId: "item-1" }),
    );
  });
});
