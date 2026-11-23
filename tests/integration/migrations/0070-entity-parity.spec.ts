import type { QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";

import { coreEntities } from "../../../packages/platform-persistence-typeorm/src/entities/composition.ts";
import { connectorDeliveryEntities } from "../../../packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts";
import { M0070ConnectorDelivery1700000000070 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0070-connector-delivery.ts";

describe("T072 migration 0070 entity parity", () => {
  it("maps durable command/outbox/inbox/event tables and delivery indexes", async () => {
    const sql: string[] = [];
    await new M0070ConnectorDelivery1700000000070().up({
      query: async (value: string) => {
        sql.push(value);
      },
    } as unknown as QueryRunner);
    expect(connectorDeliveryEntities.map((entity) => entity.options.tableName)).toEqual([
      "connector_commands",
      "command_outbox",
      "webhook_receipts",
      "consumer_inbox",
      "event_outbox",
    ]);
    expect(connectorDeliveryEntities.every((entity) => coreEntities.includes(entity))).toBe(true);
    expect(sql.join("\n")).toContain("effect_idempotency_key text NOT NULL UNIQUE");
    expect(sql.join("\n")).toContain("command_outbox_delivery_idx");
  });
});
