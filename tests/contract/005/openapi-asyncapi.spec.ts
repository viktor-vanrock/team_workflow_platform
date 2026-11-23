import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import { schemaDocuments } from "../../../packages/platform-contracts/src/index.ts";
import { verify005Contracts } from "../../../tools/contracts/verify-005-contracts.mts";

const root = resolve(
  import.meta.dirname,
  "../../../specs/005-gitlab-automated-validation/contracts",
);
const parse = (path: string) =>
  parseDocument(readFileSync(resolve(root, path), "utf8"), {
    strict: true,
    uniqueKeys: true,
  }).toJS() as Record<string, unknown>;

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child),
  );
}

describe("Feature 005 API and event contracts", () => {
  it("publishes exactly 21 unique OpenAPI operations", () => {
    const document = parse("openapi/gitlab-automated-validation-api.v1.yaml");
    const methods = new Set(["get", "put", "post", "delete", "patch"]);
    const operationIds = Object.values(
      document.paths as Record<string, Record<string, unknown>>,
    ).flatMap((item) =>
      Object.entries(item)
        .filter(([method]) => methods.has(method))
        .map(([, operation]) => (operation as Record<string, unknown>).operationId),
    );

    expect(operationIds).toHaveLength(21);
    expect(new Set(operationIds).size).toBe(21);
  });

  it("publishes all six schema-bound messages over three AsyncAPI channels", () => {
    const document = parse("asyncapi/gitlab-automated-validation-events.v1.yaml");
    const components = document.components as Record<string, Record<string, unknown>>;

    expect(Object.keys(document.channels as object)).toHaveLength(3);
    expect(Object.keys(components.messages ?? {})).toHaveLength(6);
    expect(JSON.stringify(components.messages)).not.toMatch(
      /token|rawBody|artifactBytes|providerResponse/iu,
    );
  });

  it("keeps every API/event schema ref offline and byte-parallel with the order-500 registry", () => {
    const documents = [
      { directory: "openapi", value: parse("openapi/gitlab-automated-validation-api.v1.yaml") },
      {
        directory: "asyncapi",
        value: parse("asyncapi/gitlab-automated-validation-events.v1.yaml"),
      },
    ];
    const featureDocuments = new Map(
      schemaDocuments
        .filter(({ contributionOrder }) => contributionOrder === 500)
        .map((document) => [document.id as string, document]),
    );
    const referencedSchemas = documents.flatMap(({ directory, value }) =>
      refs(value)
        .map((reference) => reference.split("#", 1)[0]!)
        .filter((reference) => reference.startsWith("../schemas/"))
        .map(
          (reference) =>
            JSON.parse(readFileSync(resolve(root, directory, reference), "utf8")) as Record<
              string,
              unknown
            >,
        ),
    );

    expect(referencedSchemas.length).toBeGreaterThan(0);
    for (const schema of referencedSchemas) {
      const id = String(schema.$id);
      expect(featureDocuments.get(id)?.schema).toEqual(schema);
    }
    expect(verify005Contracts()).toMatchObject({
      status: "PASS",
      openapiOperations: 21,
      asyncapiMessages: 6,
    });
  });
});
