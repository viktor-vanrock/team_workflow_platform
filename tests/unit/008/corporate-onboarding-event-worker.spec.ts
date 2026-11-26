import { describe, expect, it, vi } from "vitest";

import { createProjectEventEnvelope } from "../../../packages/platform-core/src/project-onboarding/primitives.ts";
import { createCorporateOnboardingEventWorker } from "../../../packages/runtime-composition/src/onboarding/corporate-event-worker.ts";

const event = createProjectEventEnvelope({
  eventId: "event",
  eventType: "PROJECT_REGISTERED",
  scope: { workspaceId: "workspace", projectId: "project" },
  subjectRef: { id: "subject", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
  reasonCode: "REGISTER",
  relatedRefs: [],
  actor: { kind: "SERVICE", principalId: "service", serviceKey: "worker" },
  occurredAt: "2026-01-01T00:00:00.000Z",
  correlationId: "correlation",
  causationId: "cause",
});
const row = {
  id: "event",
  workspace_id: "workspace",
  project_id: "project",
  event_type: "PROJECT_REGISTERED",
  envelope: event,
};

describe("corporate onboarding event worker", () => {
  it("scopes its lock to deployment and commits inbox and acknowledgement together", async () => {
    const query = vi.fn<(sql: string, params?: readonly unknown[]) => Promise<unknown[]>>(
      async (sql) => (sql.includes("FROM event_outbox") ? [row] : []),
    );
    const source = {
      isInitialized: true,
      transaction: async (work: (manager: unknown) => Promise<unknown>) => await work({ query }),
    };
    const worker = createCorporateOnboardingEventWorker(source as never, {
      workspaceId: "workspace",
      projectIds: ["project"],
    });
    expect(await worker.run()).toEqual({ applied: 1, duplicates: 0, quarantined: 0 });
    expect(query.mock.calls[0]?.[1]).toEqual(["workspace", ["project"]]);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO consumer_inbox"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("ACKNOWLEDGED"))).toBe(true);
  });
  it("quarantines a tampered event without acknowledging it", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM event_outbox")
        ? [
            {
              ...row,
              envelope: { ...event, payload: { ...event.payload, reasonCode: "TAMPERED" } },
            },
          ]
        : [],
    );
    const source = {
      isInitialized: true,
      transaction: async (work: (manager: unknown) => Promise<unknown>) => await work({ query }),
    };
    const worker = createCorporateOnboardingEventWorker(source as never, {
      workspaceId: "workspace",
      projectIds: ["project"],
    });
    expect(await worker.run()).toEqual({ applied: 0, duplicates: 0, quarantined: 1 });
    expect(query.mock.calls.some(([sql]) => sql.includes("ACKNOWLEDGED"))).toBe(false);
  });
});
