import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";
import { verify005Contracts } from "../../../tools/contracts/verify-005-contracts.mts";

const workspace = resolve(import.meta.dirname, "../../..");

describe("Feature 005 design contracts", () => {
  it("validates all schemas, fixtures, rejection keywords and semantic vectors offline", () => {
    expect(verify005Contracts(workspace)).toMatchObject({
      status: "PASS",
      schemas: 31,
      positiveExamples: 4,
      negativeExamples: 4,
      references: 724,
      openapiOperations: 21,
      asyncapiChannels: 3,
      asyncapiMessages: 6,
      semanticVectors: 2,
      errors: [],
    });
  });

  it("registers exactly the 31 order-500 schemas without remote resolution", () => {
    const feature = schemaDocuments.filter(({ contributionOrder }) => contributionOrder === 500);
    expect(feature).toHaveLength(31);
    expect(feature.every(({ id }) => id.startsWith("urn:awp:schemas:005:"))).toBe(true);
    expect(() => new OfflineSchemaRegistry(schemaDocuments)).not.toThrow();
  });

  it("rejects caller authority even when the fixture is otherwise structurally plausible", () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          workspace,
          "specs/005-gitlab-automated-validation/contracts/examples/negative/automated-session.unknown-provider-authority.v1.json",
        ),
        "utf8",
      ),
    ) as unknown;

    expect(() =>
      registry.validateById("urn:awp:schemas:005:automated-test-session:v1", fixture),
    ).toThrow();
  });
});
