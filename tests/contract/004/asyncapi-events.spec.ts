import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { schemaDocuments } from "../../../packages/platform-contracts/src/generated/schema-documents.ts";

interface Message {
  readonly name: string;
  readonly payload: Readonly<{ allOf: readonly unknown[] }>;
}
describe("004 AsyncAPI event parity", () => {
  it("binds all 20 messages to immutable registered payload schemas", async () => {
    const doc = parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../specs/004-mattermost-hermes-intake/contracts/asyncapi/mattermost-hermes-events.v1.yaml",
        ),
        "utf8",
      ),
    ) as Readonly<{ components: Readonly<{ messages: Readonly<Record<string, Message>> }> }>;
    const messages = Object.values(doc.components.messages);
    expect(messages).toHaveLength(20);
    const ids = new Set<string>(schemaDocuments.map(({ id }) => id));
    for (const message of messages) {
      const branch = message.payload.allOf[1] as Readonly<{
        properties: Readonly<{
          payloadSchemaRef: Readonly<{
            properties: Readonly<{
              id: Readonly<{ const: string }>;
              version: Readonly<{ const: number }>;
            }>;
          }>;
        }>;
      }>;
      const ref = branch.properties.payloadSchemaRef.properties;
      expect(ref.version.const).toBe(1);
      expect(ids.has(ref.id.const)).toBe(true);
    }
    expect(new Set(messages.map(({ name }) => name)).size).toBe(20);
  });
  it("retains runtime producer names without provider bodies", async () => {
    const sources = await Promise.all(
      [
        "packages/runtime-composition/src/intake/candidate-events.ts",
        "packages/runtime-composition/src/mattermost/notification-projection.ts",
        "packages/runtime-composition/src/hermes/proposal-agent-run.ts",
      ].map(async (path) => await readFile(resolve(import.meta.dirname, "../../..", path), "utf8")),
    );
    expect(sources.join("\n")).not.toMatch(/response_url|botToken|renderedPrompt/iu);
  });
});
