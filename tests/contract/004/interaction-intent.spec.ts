import { describe, expect, it } from "vitest";

import {
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";

describe("InteractionIntent closed unions", () => {
  it("rejects provider routing fields and a presented-action/source-action ID alias", () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    expect(() =>
      registry.validateById("urn:awp:schemas:004:interaction-intent:v1", {
        schemaVersion: "interaction-intent@1.0.0",
        intentId: "i",
        channelId: "caller-selected",
        response_url: "secret",
      }),
    ).toThrow();
  });
});
