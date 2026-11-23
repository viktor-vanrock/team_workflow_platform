import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type JsonRecord = Record<string, unknown>;
const root = resolve(import.meta.dirname, "../../..");
const openapi = parse(
  readFileSync(
    resolve(
      root,
      "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-evidence-api.v1.yaml",
    ),
    "utf8",
  ),
) as JsonRecord;
const asyncapi = parse(
  readFileSync(
    resolve(
      root,
      "specs/007-project-onboarding-evidence-security/contracts/asyncapi/project-onboarding-evidence-events.v1.yaml",
    ),
    "utf8",
  ),
) as JsonRecord;
const methods = new Set(["get", "put", "post", "delete", "patch"]);

function record(value: unknown): JsonRecord {
  return value as JsonRecord;
}

describe("Feature 007 HTTP and event boundaries", () => {
  it("publishes exactly 20 unique Workspace/Project-scoped operations", () => {
    const operations = Object.entries(record(openapi.paths)).flatMap(([path, item]) =>
      Object.entries(record(item))
        .filter(([method]) => methods.has(method))
        .map(([method, operation]) => ({ path, method, ...record(operation) })),
    );
    expect(openapi.openapi).toBe("3.1.0");
    expect(operations).toHaveLength(20);
    expect(new Set(operations.map((operation) => record(operation).operationId))).toHaveProperty(
      "size",
      20,
    );
    expect(
      operations.every(({ path }) => path.startsWith("/v1/workspaces/{workspaceId}/projects")),
    ).toBe(true);
    expect(
      operations.every(
        ({ path }) =>
          path === "/v1/workspaces/{workspaceId}/projects" || path.includes("{projectId}"),
      ),
    ).toBe(true);
  });

  it("keeps server-authored identity, scope, audit and digest fields out of command bodies", () => {
    const components = record(record(openapi.components).schemas);
    const commandNames = Object.keys(components).filter((name) => /Command$/u.test(name));
    expect(commandNames.length).toBeGreaterThan(8);
    const forbidden = new Set([
      "actor",
      "createdAt",
      "createdBy",
      "publishedAt",
      "contentHash",
      "workspaceId",
      "projectId",
      "authorizationBasisRef",
      "effectiveClassificationKey",
    ]);
    for (const name of commandNames) {
      const properties = Object.keys(record(record(components[name]).properties));
      expect(
        properties.filter((property) => forbidden.has(property)),
        name,
      ).toEqual([]);
    }
  });

  it("publishes the closed three-channel/five-operation AsyncAPI surface", () => {
    expect(asyncapi.asyncapi).toBe("3.0.0");
    expect(Object.keys(record(asyncapi.channels)).sort()).toEqual([
      "artifactEvents",
      "projectEvents",
      "qaEvidenceEvents",
    ]);
    expect(Object.keys(record(asyncapi.operations)).sort()).toEqual([
      "consumeProjectEvents",
      "consumeQaEvidenceEvents",
      "publishArtifactEvents",
      "publishProjectEvents",
      "publishQaEvidenceEvents",
    ]);
  });
});
