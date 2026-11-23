import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  type JsonValue,
  OfflineSchemaRegistry,
  schemaDocuments,
  sha256,
} from "../../../packages/platform-contracts/src/index.ts";
import { verify006Contracts } from "../../../tools/contracts/verify-006-contracts.mts";

const workspace = resolve(import.meta.dirname, "../../..");
const schemaRoot = resolve(workspace, "specs/006-queue-triage-capacity-sla/contracts/schemas");
const schemas = readdirSync(schemaRoot)
  .filter((name) => name.endsWith(".schema.json"))
  .sort()
  .map(
    (name) =>
      JSON.parse(readFileSync(resolve(schemaRoot, name), "utf8")) as Record<string, JsonValue>,
  );

describe("Feature 006 design contracts", () => {
  it("validates every declared schema/example/ref and the semantic calendar negative offline", () => {
    expect(verify006Contracts(workspace)).toMatchObject({
      status: "PASS",
      schemas: 16,
      examples: 9,
      positiveExamples: 4,
      negativeExamples: 5,
      queueOpenapiOperations: 11,
      approvalOpenapiOperations: 2,
      asyncapiChannels: 6,
      asyncapiMessages: 15,
      semanticVectors: 1,
      errors: [],
    });
  });

  it("publishes absolute immutable IDs, closed roots and exact RFC 8785/JCS digests", () => {
    const result = verify006Contracts(workspace);
    const ids = schemas.map((schema) => String(schema.$id));

    expect(new Set(ids).size).toBe(16);
    expect(ids.every((id) => id.startsWith("urn:awp:"))).toBe(true);
    for (const schema of schemas) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
      expect(result.schemaDigests[String(schema.$id)]).toBe(sha256(schema));
      expect(canonicalize(JSON.parse(canonicalize(schema)) as JsonValue)).toBe(
        canonicalize(schema),
      );
    }
  });

  it("registers exactly 16 immutable order-600 schemas without collision or remote resolution", () => {
    const feature = schemaDocuments.filter(({ contributionOrder }) => contributionOrder === 600);
    expect(feature).toHaveLength(16);
    expect(new Set(feature.map(({ id }) => id)).size).toBe(16);
    expect(feature.map(({ id }) => id).sort()).toEqual(
      schemas.map((schema) => String(schema.$id)).sort(),
    );
    expect(() => new OfflineSchemaRegistry(schemaDocuments)).not.toThrow();
  });

  it("keeps every root version discriminator and finite union explicit", () => {
    for (const schema of schemas) {
      const serialized = JSON.stringify(schema);
      expect(serialized).not.toMatch(/"additionalProperties":true/u);
      expect(serialized).not.toMatch(/"type":"any"|"enum":\[\]/u);
      expect(schema.required).toBeInstanceOf(Array);
    }
  });
});
