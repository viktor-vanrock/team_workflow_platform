import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import * as envelopeModule from "../../../packages/platform-core/src/events/event-envelope.ts";
import * as processingModule from "../../../packages/platform-core/src/events/event-processing.ts";
import { requiredFixture } from "../../support/fixture-value.ts";

const root = resolve(import.meta.dirname, "../../..");
const asyncapi = parseDocument(
  readFileSync(
    resolve(
      root,
      "specs/006-queue-triage-capacity-sla/contracts/asyncapi/queue-triage-capacity-sla-events.v1.yaml",
    ),
    "utf8",
  ),
).toJS() as Record<string, unknown>;
const canonicalEnvelope = JSON.parse(
  readFileSync(
    resolve(
      root,
      "specs/001-extension-kernel-local-skeleton/contracts/schemas/events/event-envelope.v1.schema.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

function queueEnvelope() {
  return {
    envelopeVersion: 1,
    eventId: "10000000-0000-4000-8000-000000000001",
    eventType: "queue.projection.updated",
    occurredAt: new Date("2026-09-02T10:00:00Z"),
    recordedAt: new Date("2026-09-02T10:00:01Z"),
    producer: "queue-projector",
    producerVersion: "1.0.0",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    projectId: "10000000-0000-4000-8000-000000000003",
    entityType: "queue-entry",
    entityId: "10000000-0000-4000-8000-000000000004",
    entityVersion: 3,
    correlationId: "10000000-0000-4000-8000-000000000005",
    causationId: "10000000-0000-4000-8000-000000000006",
    actor: { kind: "SERVICE", serviceId: "queue-projector" },
    dataClassificationKey: "INTERNAL",
    payloadVersion: 1,
    payloadSchemaRef: {
      id: "urn:awp:schemas:006:queue-entry:v1",
      version: 1,
      digest: "sha256:b7a0b1362563b4d57bedf8418df8e7591c2da597ce336b912d229cafbfa95bbe",
    },
    payload: {
      queueEntryId: "10000000-0000-4000-8000-000000000004",
      revision: 3,
      workspaceId: "10000000-0000-4000-8000-000000000002",
      projectId: "10000000-0000-4000-8000-000000000003",
      calculatedAt: "2026-09-02T10:00:00Z",
    },
  } as const;
}

describe("Feature 006 canonical event envelope binding", () => {
  it("keeps the local AsyncAPI envelope mirror field-for-field equal to canonical EventEnvelope v1", () => {
    const schemas = (asyncapi.components as Record<string, unknown>).schemas as Record<
      string,
      Record<string, unknown>
    >;
    const mirror = requiredFixture(schemas.ProjectEnvelope).schema as Record<string, unknown>;
    expect(mirror.required).toEqual(canonicalEnvelope.required);
    expect(mirror.additionalProperties).toBe(false);
    expect(Object.keys(mirror.properties as object).sort()).toEqual(
      Object.keys(canonicalEnvelope.properties as object).sort(),
    );
  });

  it("accepts exact binding and rejects every duplicated envelope/payload field independently", () => {
    const validate = (value: unknown) =>
      (
        envelopeModule as unknown as { validateEventPayloadBinding(value: unknown): void }
      ).validateEventPayloadBinding(value);
    expect(() => validate(queueEnvelope())).not.toThrow();
    for (const [field, value] of [
      ["workspaceId", "20000000-0000-4000-8000-000000000002"],
      ["projectId", "20000000-0000-4000-8000-000000000003"],
      ["entityId", "20000000-0000-4000-8000-000000000004"],
      ["entityVersion", 4],
      ["occurredAt", new Date("2026-09-02T10:00:02Z")],
    ] as const) {
      expect(() => validate({ ...queueEnvelope(), [field]: value }), field).toThrow(
        /EVENT_.*MISMATCH/u,
      );
    }
  });

  it("validates before sequencing and quarantines mismatch without advancing the cursor", async () => {
    const inbox = new processingModule.InMemoryEventInbox();
    const processBound = async (inbox: unknown, consumer: string, event: unknown) =>
      await (
        processingModule as unknown as {
          processBoundEvent(inbox: unknown, consumer: string, event: unknown): Promise<unknown>;
        }
      ).processBoundEvent(inbox, consumer, event);
    const mismatched = { ...queueEnvelope(), entityVersion: 4 };
    await expect(processBound(inbox, "queue", mismatched)).rejects.toThrow(/MISMATCH/u);
    expect(inbox.versions.size).toBe(0);
    expect(inbox.messages.size).toBe(0);
  });

  it("writes canonical READY envelopes while keeping a bounded payload-only legacy adapter", () => {
    const source = readFileSync(
      resolve(root, "packages/competency-qa/src/persistence/automated-session.uow.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /envelopeVersion[\s\S]*payloadSchemaRef[\s\S]*qa\.automated-session\.ready/u,
    );
    expect(source).toMatch(/legacy[\s\S]*(?:payload-only|payloadOnly|trusted row)/iu);
    expect(source).not.toMatch(
      /legacy[\s\S]*synthesi[sz]e[\s\S]*(?:correlation|causation|actor)/iu,
    );
  });

  it("rejects dual emission for both mutually exclusive event pairs", () => {
    const validatePair = (types: readonly string[]) =>
      (
        processingModule as unknown as {
          validateMutuallyExclusiveEmission(types: readonly string[]): void;
        }
      ).validateMutuallyExclusiveEmission(types);
    expect(() => validatePair(["queue.projection.updated"])).not.toThrow();
    expect(() => validatePair(["queue.projection.updated", "queue.control.changed"])).toThrow(
      /MUTUALLY_EXCLUSIVE/u,
    );
    expect(() =>
      validatePair(["capacity.admission.decided", "capacity.over-limit-detected"]),
    ).toThrow(/MUTUALLY_EXCLUSIVE/u);
  });
});
