import { describe, expect, it, vi } from "vitest";

import {
  createQaQueueFacts,
  QaQueueFactsProjectionService,
  qaQueueSourceSetHash,
} from "../../../packages/competency-qa/src/application/queue-facts.ts";
import { BoundQaFactProjector } from "../../../packages/runtime-composition/src/queue/qa-fact-projector.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
};
const refs = [
  { sourceType: "QA_SESSION" as const, sourceId: "s2", sourceVersion: 2, semanticHash: hash("b") },
  { sourceType: "QA_INPUT" as const, sourceId: "i1", sourceVersion: 1, semanticHash: hash("a") },
];
const facts = createQaQueueFacts({
  ...scope,
  workItemId: "10000000-0000-4000-8000-000000000003",
  qaInputRef: refs[1]!,
  readinessRef: null,
  readiness: "NOT_ASSESSED",
  requiredSessionPlanRef: null,
  requiredCapabilities: [],
  activities: [],
  automationRefs: [],
  firstConsumingStartAt: null,
  signedVerdictRef: null,
  sourceRefs: refs,
});

describe("US1 QA queue facts", () => {
  it("sorts exact sources and produces an order-independent source-set hash", () => {
    expect(facts.sourceRefs.map(({ sourceId }) => sourceId)).toEqual(["i1", "s2"]);
    expect(facts.sourceSetHash).toBe(qaQueueSourceSetHash([...refs].reverse()));
  });

  it("commits one semantic revision and its invalidation atomically, then no-ops", async () => {
    const commit = vi
      .fn()
      .mockResolvedValueOnce({ changed: true, revisionNumber: 1 })
      .mockResolvedValueOnce({ changed: false, revisionNumber: 1 });
    const service = new QaQueueFactsProjectionService({ commit });
    const input = {
      facts,
      semanticHash: facts.sourceSetHash,
      invalidationId: "10000000-0000-4000-8000-000000000004",
      occurredAt: "2026-09-02T12:00:00.000Z",
      correlationId: "c1",
      causationId: "c0",
    };
    await expect(service.project(input)).resolves.toMatchObject({
      changed: true,
      revisionNumber: 1,
    });
    await expect(service.project(input)).resolves.toMatchObject({
      changed: false,
      revisionNumber: 1,
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[0]![0]).toMatchObject({
      facts,
      event: { eventType: "qa.queue-facts.changed" },
    });
  });

  it("dedupes canonical and bounded trusted-row legacy READY inputs without merging provenance", async () => {
    const projected = vi.fn().mockResolvedValue(undefined);
    const projector = new BoundQaFactProjector(projected);
    const legacy = {
      id: "10000000-0000-4000-8000-000000000010",
      ...scope,
      eventType: "qa.automated-session.ready" as const,
      createdAt: "2026-09-02T12:00:00.000Z",
      envelope: {
        sessionId: "10000000-0000-4000-8000-000000000011",
        workItemId: facts.workItemId,
        mode: "AUTOMATED",
        state: "READY",
        suiteBindingRef: { id: "suite", version: 1, contentHash: hash("c") },
        targetSnapshotHash: hash("d"),
        scopeSnapshotHash: hash("e"),
        configurationPinSetHash: hash("f"),
      },
    };
    await expect(projector.consumeLegacyReady(legacy)).resolves.toBe("PROCESSED");
    await expect(projector.consumeLegacyReady(legacy)).resolves.toBe("DUPLICATE");
    expect(projected).toHaveBeenCalledTimes(1);
    expect(projected.mock.calls[0]![0]).toMatchObject({ validationKind: "LEGACY_PAYLOAD_ONLY" });

    const canonicalId = "10000000-0000-4000-8000-000000000020";
    const canonical = {
      envelopeVersion: 1 as const,
      eventId: canonicalId,
      eventType: "qa.automated-session.ready",
      occurredAt: new Date("2026-09-02T12:00:00.000Z"),
      recordedAt: new Date("2026-09-02T12:00:00.000Z"),
      producer: "competency-qa",
      producerVersion: "1.3.0",
      ...scope,
      entityType: "qa-test-session",
      entityId: "10000000-0000-4000-8000-000000000021",
      entityVersion: 1,
      correlationId: "c1",
      causationId: "c0",
      actor: {
        kind: "SERVICE" as const,
        principalId: "10000000-0000-4000-8000-000000000022",
        serviceKey: "qa-projector",
      },
      dataClassificationKey: "INTERNAL",
      payloadVersion: 1,
      payloadSchemaRef: {
        id: "urn:awp:schemas:qa:event-payload:automated-session-ready:v1",
        version: 1,
        digest: hash("1"),
      },
      payload: { ...legacy.envelope, sessionId: "10000000-0000-4000-8000-000000000021" },
    };
    await expect(projector.consumeCanonical(canonical)).resolves.toBe("PROCESSED");
    await expect(projector.consumeCanonical(canonical)).resolves.toBe("DUPLICATE");
    expect(projected).toHaveBeenCalledTimes(2);
    expect(projected.mock.calls[1]![0]).toMatchObject({ validationKind: "CANONICAL_ENVELOPE" });
    await expect(projector.consumeLegacyReady({ ...legacy, id: canonicalId })).rejects.toThrow(
      "QA_FACT_TRANSPORT_ID_COLLISION",
    );
  });
});
