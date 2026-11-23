import { describe, expect, it, vi } from "vitest";

import {
  type SerializedCapacityAdmissionRequest,
  SerializedCapacityAdmissionService,
} from "../../../packages/runtime-composition/src/index.ts";

const request = (
  projectId: string,
  workItemId: string,
  requestKey: string,
  activityKind: "MANUAL_SESSION_START" | "AUTOMATED_SESSION_LAUNCH" = "MANUAL_SESSION_START",
): SerializedCapacityAdmissionRequest => ({
  workspaceId: "workspace",
  projectId,
  workItemId,
  sessionId: `session-${workItemId}`,
  principalId: "lead",
  requestKey,
  activityKind,
  expectedState: { sessionVersion: 1 },
});

describe("US4 concurrent capacity admission", () => {
  it("serializes the last Workspace slot across Projects with PostgreSQL authority", async () => {
    let committed = 0;
    let tail = Promise.resolve();
    const results = new Map<
      string,
      Readonly<{ requestHash: string; result: Readonly<Record<string, unknown>> }>
    >();
    const transaction = async <T>(work: (value: { locked: true }) => Promise<T>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work({ locked: true });
      } finally {
        release();
      }
    };
    const service = new SerializedCapacityAdmissionService({
      transaction,
      authorize: vi.fn().mockResolvedValue(true),
      replay: vi.fn(async (_transaction, { requestKeyHash }) => results.get(requestKeyHash)),
      lockAndRead: vi.fn(async () => ({
        policyMode: "ENFORCED" as const,
        current: { humanCommittedCount: committed, activeExpediteCount: 0 },
        workspaceHumanWipLimit: 1,
        activeExpediteLimit: 1,
        targetHasClaim: false,
        targetHasReservation: false,
        targetHasExpedite: false,
      })),
      persist: vi.fn(async (_transaction, value) => {
        const result = Object.freeze({
          projectId: value.request.projectId,
          outcome: value.evaluation.outcome,
        });
        if (value.evaluation.outcome === "ADMITTED") committed += 1;
        results.set(value.requestKeyHash, { requestHash: value.requestHash, result });
        return result;
      }),
    });
    const settled = await Promise.all([
      service.admit(request("A", "one", "manual-start-project-a-001")),
      service.admit(
        request("B", "two", "automation-launch-project-b-01", "AUTOMATED_SESSION_LAUNCH"),
      ),
    ]);
    expect(settled.map(({ outcome }) => outcome).sort()).toEqual(["ADMITTED", "DENIED"]);
    expect(committed).toBe(1);
    expect(JSON.stringify(service)).not.toMatch(/external.*broker/iu);
  });

  it.each(["40001", "40P01"])(
    "retries bounded PostgreSQL %s conflicts and replays the same result",
    async (code) => {
      let attempts = 0;
      const stored = new Map<
        string,
        Readonly<{ requestHash: string; result: { outcome: string } }>
      >();
      const service = new SerializedCapacityAdmissionService({
        transaction: async (work) => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("retry"), { code });
          return await work({});
        },
        authorize: vi.fn().mockResolvedValue(true),
        replay: vi.fn(async (_transaction, { requestKeyHash }) => stored.get(requestKeyHash)),
        lockAndRead: vi.fn(async () => ({
          policyMode: "ENFORCED" as const,
          current: { humanCommittedCount: 0, activeExpediteCount: 0 },
          workspaceHumanWipLimit: 1,
          activeExpediteLimit: 1,
          targetHasClaim: false,
          targetHasReservation: false,
          targetHasExpedite: false,
        })),
        persist: vi.fn(async (_transaction, value) => {
          const result = { outcome: value.evaluation.outcome };
          stored.set(value.requestKeyHash, { requestHash: value.requestHash, result });
          return result;
        }),
      });
      const input = request("A", "one", `retry-${code}-request-0001`);
      await expect(service.admit(input)).resolves.toEqual({ outcome: "ADMITTED" });
      expect(attempts).toBe(2);
      await expect(service.admit(input)).resolves.toEqual({ outcome: "ADMITTED" });
      expect(attempts).toBe(3);
    },
  );
});
