import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";
import { verify004Contracts } from "../../../tools/contracts/verify-004-contracts.mts";

const workspace = resolve(import.meta.dirname, "../../..");

describe("Feature 004 design contracts", () => {
  it("strictly validates all schemas, examples, refs and the AEAD vector offline", () => {
    expect(verify004Contracts(workspace)).toMatchObject({
      status: "PASS",
      schemas: 43,
      examples: 3,
      openapiOperations: 20,
      asyncapiChannels: 5,
      asyncapiMessages: 20,
      aeadVectors: 1,
    });
  });

  it("registers all 43 order-400 schemas without mutating prior contributions", () => {
    const feature = schemaDocuments.filter(({ contributionOrder }) => contributionOrder === 400);
    expect(feature).toHaveLength(43);
    expect(() => new OfflineSchemaRegistry(schemaDocuments)).not.toThrow();
  });

  it("rejects a production pilot example", () => {
    const local = JSON.parse(
      readFileSync(resolve(workspace, "config/local/mattermost-pilot-metadata.v1.json"), "utf8"),
    ) as Record<string, unknown>;
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    expect(() =>
      registry.validateById("urn:awp:schemas:004:mattermost-pilot-metadata:v1", {
        ...local,
        environmentClass: "PRODUCTION",
      }),
    ).toThrow();
  });
});
