import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  designContractRegistry,
  schemaDocumentById,
} from "../../packages/platform-contracts/src/index.ts";
import {
  type EventEnvelope,
  validateEventEnvelope,
} from "../../packages/platform-core/src/index.ts";
import { TypeOrmEventOutboxRepository } from "../../packages/platform-persistence-typeorm/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
describe("AsyncAPI and Event Envelope round-trip", () => {
  it("binds AsyncAPI operations to the exact event and command-job schemas", async () => {
    const document = parse(
      await readFile(
        resolve(
          root,
          "specs/001-extension-kernel-local-skeleton/contracts/asyncapi/platform-events.v1.yaml",
        ),
        "utf8",
      ),
    ) as {
      asyncapi: string;
      operations: Record<string, unknown>;
      components: {
        messages: {
          OperationalEvent: { payload: { $ref: string } };
          ResolvedExternalCommand: { payload: { $ref: string } };
        };
      };
    };
    expect(document.asyncapi).toBe("3.0.0");
    expect(Object.keys(document.operations)).toEqual([
      "publishOperationalEvent",
      "consumeOperationalEvent",
      "dispatchResolvedExternalCommand",
      "executeResolvedExternalCommand",
    ]);
    expect(document.components.messages.OperationalEvent.payload.$ref).toBe(
      "../schemas/events/event-envelope.v1.schema.json",
    );
    expect(document.components.messages.ResolvedExternalCommand.payload.$ref).toBe(
      "../schemas/commands/external-command-job.v1.schema.json",
    );
  });

  it("preserves envelope/producer versions, recorded time and exact payload schema ref through persistence", async () => {
    const raw = JSON.parse(
      await readFile(
        resolve(
          root,
          "specs/001-extension-kernel-local-skeleton/contracts/examples/events/sample-record-published.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    designContractRegistry.validateById("urn:awp:contracts:events:event-envelope:v1", raw);
    const payloadDocument = schemaDocumentById.get(
      String((raw.payloadSchemaRef as Record<string, unknown>).id),
    )!;
    expect(raw.payloadSchemaRef).toEqual({
      id: payloadDocument.id,
      version: 1,
      digest: payloadDocument.digest,
    });
    const envelope = {
      ...raw,
      occurredAt: new Date(String(raw.occurredAt)),
      recordedAt: new Date(String(raw.recordedAt)),
    } as unknown as EventEnvelope;
    validateEventEnvelope(envelope);
    let stored: unknown;
    const source = {
      query: async (sql: string, parameters?: readonly unknown[]) => {
        if (sql.startsWith("INSERT")) {
          stored = parameters?.[4];
          return [];
        }
        if (sql.startsWith("SELECT")) return [{ envelope: stored }];
        return [];
      },
    };
    const repository = new TypeOrmEventOutboxRepository(source as never);
    await repository.append(envelope);
    const [roundTrip] = await repository.ready();
    expect(roundTrip).toMatchObject({
      envelopeVersion: 1,
      producer: "dummy",
      producerVersion: "1.0.0",
      payloadVersion: 1,
      payloadSchemaRef: raw.payloadSchemaRef,
    });
    expect(roundTrip!.occurredAt.toISOString()).toBe("2026-08-27T10:22:00.000Z");
    expect(roundTrip!.recordedAt.toISOString()).toBe("2026-08-27T10:22:01.000Z");
  });
});
