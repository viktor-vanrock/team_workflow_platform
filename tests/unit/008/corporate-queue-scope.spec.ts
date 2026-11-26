import { describe, expect, it, vi } from "vitest";
import {
  PostgresQueueProjectionWorker,
  QueueProjectionCoordinator,
} from "../../../packages/runtime-composition/src/queue/projection-worker.ts";
import { PostgresQueueTemporalTransitionWorker } from "../../../packages/runtime-composition/src/queue/temporal-transition-worker.ts";

describe("corporate queue workers", () => {
  const scope = { workspaceId: "workspace", projectIds: ["project"] };
  it("filters projection source events by deployment before the batch limit", async () => {
    const query = vi.fn(async (_sql: string, _parameters: readonly unknown[]) => []);
    const worker = new PostgresQueueProjectionWorker(
      { query } as never,
      { consume: vi.fn() } as never,
      scope,
    );
    await worker.run();
    expect(query.mock.calls[0]?.[0]).toContain("outbox.project_id=ANY($4::uuid[])");
    expect(query.mock.calls[0]?.[1].slice(2)).toEqual(["workspace", ["project"]]);
  });
  it("resolves GitLab attempt events to their work item before projection", async () => {
    const query = vi.fn(async (sql: string, _parameters: readonly unknown[]) => {
      if (sql.includes("FROM event_outbox"))
        return [
          {
            id: "event",
            workspace_id: "workspace",
            project_id: "project",
            event_type: "qa.automation-attempt.completed",
            envelope_hash: "hash",
            created_at: "2026-01-01T00:00:00Z",
            envelope: { eventId: "event", entityId: "attempt", entityVersion: 1 },
          },
        ];
      if (sql.includes("FROM qa_automation_attempts")) return [{ work_item_id: "work-item" }];
      return [{ message_id: "event" }];
    });
    const consume = vi.fn(async () => undefined);
    const worker = new PostgresQueueProjectionWorker(
      { query } as never,
      { consume } as never,
      scope,
    );
    expect((await worker.run()).invalidations).toBe(1);
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "work-item",
        versionSourceId: "attempt",
        entityVersion: 1,
      }),
    );
    expect(query.mock.calls[1]?.[1]).toEqual(["workspace", "project", "attempt"]);
  });
  it("does not confuse the version counters of two attempts on the same work item", async () => {
    const readCurrent = vi.fn(async () => ({ subjectId: "work-item", sourceRefs: [] }));
    const coordinator = new QueueProjectionCoordinator({
      readCurrent,
      appendIfChanged: async () => ({ changed: true, revisionNumber: 1 }),
      suppressPrecursor: async () => undefined,
    } as never);
    const event = {
      eventType: "qa.automation-attempt.completed",
      entityId: "work-item",
      entityVersion: 1,
      scope: { workspaceId: "workspace", projectId: "project" },
    };
    expect(
      (await coordinator.consume({ ...event, eventId: "one", versionSourceId: "attempt-one" }))
        .status,
    ).toBe("PROCESSED");
    expect(
      (await coordinator.consume({ ...event, eventId: "two", versionSourceId: "attempt-two" }))
        .status,
    ).toBe("PROCESSED");
    expect(readCurrent).toHaveBeenCalledTimes(2);
  });
  it("does not acknowledge an automation event if its scoped attempt is missing", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM event_outbox")
        ? [
            {
              id: "event",
              workspace_id: "workspace",
              project_id: "project",
              event_type: "qa.automation-attempt.completed",
              envelope_hash: "hash",
              created_at: "2026-01-01T00:00:00Z",
              envelope: { eventId: "event", entityId: "attempt", entityVersion: 1 },
            },
          ]
        : [],
    );
    const consume = vi.fn();
    const worker = new PostgresQueueProjectionWorker(
      { query } as never,
      { consume } as never,
      scope,
    );
    await expect(worker.run()).rejects.toThrow("QUEUE_AUTOMATION_ATTEMPT_SUBJECT_MISSING");
    expect(consume).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO consumer_inbox"))).toBe(
      false,
    );
  });
  it("filters each temporal source before claiming due items", async () => {
    const query = vi.fn(async (_sql: string, _parameters: readonly unknown[]) => []);
    const worker = new PostgresQueueTemporalTransitionWorker(
      { query } as never,
      {} as never,
      () => "2026-01-01T00:00:00.000Z",
      scope,
    );
    await worker.run();
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql, parameters] of query.mock.calls) {
      expect(sql).toContain("workspace_id=");
      expect(sql).toContain("project_id=ANY(");
      expect(parameters).toContain("workspace");
      expect(parameters).toContainEqual(["project"]);
    }
  });
  it("rejects an empty deployment scope", () => {
    expect(
      () =>
        new PostgresQueueProjectionWorker({} as never, undefined, {
          workspaceId: "workspace",
          projectIds: [],
        }),
    ).toThrow("QUEUE_PROJECTION_SCOPE_INVALID");
    expect(
      () =>
        new PostgresQueueTemporalTransitionWorker({} as never, {} as never, undefined, {
          workspaceId: "workspace",
          projectIds: [],
        }),
    ).toThrow("QUEUE_TEMPORAL_SCOPE_INVALID");
  });
});
