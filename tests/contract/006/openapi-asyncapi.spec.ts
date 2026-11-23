import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import {
  type JsonValue,
  schemaDocuments,
  sha256,
} from "../../../packages/platform-contracts/src/index.ts";
import { verify006Contracts } from "../../../tools/contracts/verify-006-contracts.mts";

const root = resolve(import.meta.dirname, "../../../specs/006-queue-triage-capacity-sla/contracts");
const parse = (path: string) =>
  parseDocument(readFileSync(resolve(root, path), "utf8"), {
    strict: true,
    uniqueKeys: true,
  }).toJS() as Record<string, unknown>;

function operations(
  document: Record<string, unknown>,
): readonly { readonly path: string; readonly method: string; readonly id: string }[] {
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  return Object.entries(document.paths as Record<string, Record<string, unknown>>).flatMap(
    ([path, item]) =>
      Object.entries(item)
        .filter(([method]) => methods.has(method))
        .map(([method, operation]) => ({
          path,
          method,
          id: String((operation as Record<string, unknown>).operationId ?? ""),
        })),
  );
}

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child),
  );
}

describe("Feature 006 OpenAPI and AsyncAPI contracts", () => {
  const queue = parse("openapi/queue-triage-capacity-sla-api.v1.yaml");
  const approval = parse("openapi/core-approval-api.v1.1.yaml");
  const asyncapi = parse("asyncapi/queue-triage-capacity-sla-events.v1.yaml");

  it("publishes 11 queue and two additive Approval operations without identity/path collisions", () => {
    const queueOperations = operations(queue);
    const approvalOperations = operations(approval);
    const combined = [...queueOperations, ...approvalOperations];

    expect(queueOperations).toHaveLength(11);
    expect(approvalOperations).toHaveLength(2);
    expect(new Set(combined.map(({ id }) => id)).size).toBe(13);
    expect(new Set(combined.map(({ path, method }) => `${method}:${path}`)).size).toBe(13);
    expect(combined.every(({ id }) => id.length > 0)).toBe(true);
  });

  it("keeps the existing Approval routes additive with a frozen v1/v2 response union", () => {
    const serialized = JSON.stringify(approval);
    expect(serialized).toContain("urn:awp:contracts:commands:approval-subject:v1");
    expect(serialized).toContain("urn:awp:contracts:commands:approval-subject:v2");
    expect(serialized).toContain("getApprovalV11");
    expect(serialized).toContain("decideApprovalV11");
    expect(serialized).not.toContain("/api/v2/");
  });

  it("publishes six channels and 15 uniquely named schema-bound messages", () => {
    const components = asyncapi.components as Record<string, Record<string, unknown>>;
    const messages = Object.values(components.messages ?? {}) as readonly Record<string, unknown>[];
    const names = messages.map(({ name }) => String(name));

    expect(Object.keys(asyncapi.channels as object)).toHaveLength(6);
    expect(messages).toHaveLength(15);
    expect(new Set(names).size).toBe(15);
    expect(names).toContain("qa.automated-session.ready");
    expect(names).toContain("capacity.over-limit-detected");
    expect(names).toContain("sla.breached");
  });

  it("pins every local event payload to its exact order-600 JCS digest", () => {
    const components = asyncapi.components as Record<string, Record<string, unknown>>;
    const componentSchemas = components.schemas ?? {};
    const schemaPins = Object.values(componentSchemas).flatMap((entry) => {
      const schema = (entry as Record<string, unknown>).schema as
        Record<string, unknown> | undefined;
      const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
      const id = properties?.id?.const;
      const digest = properties?.digest?.const;
      return typeof id === "string" && typeof digest === "string" ? [{ id, digest }] : [];
    });
    const payloadPaths = refs((components.messages ?? {}) as object)
      .filter((reference) => reference.startsWith("../schemas/"))
      .map((reference) =>
        resolve(
          dirname(resolve(root, "asyncapi/queue-triage-capacity-sla-events.v1.yaml")),
          reference,
        ),
      );

    expect(payloadPaths.length).toBeGreaterThan(0);
    for (const path of new Set(payloadPaths)) {
      const schema = JSON.parse(readFileSync(path, "utf8")) as Record<string, JsonValue>;
      expect(schemaPins).toContainEqual({ id: schema.$id, digest: sha256(schema) });
    }
  });

  it("matches the generated registry and strict offline verifier", () => {
    const registry = new Map(
      schemaDocuments
        .filter(({ contributionOrder }) => contributionOrder === 600)
        .map((document) => [document.id as string, document]),
    );
    const localSchemaPaths = [
      ...new Set(refs(asyncapi).filter((reference) => reference.startsWith("../schemas/"))),
    ];
    for (const reference of localSchemaPaths) {
      const schema = JSON.parse(
        readFileSync(resolve(root, "asyncapi", reference), "utf8"),
      ) as Record<string, JsonValue>;
      expect(registry.get(String(schema.$id))?.schema).toEqual(schema);
    }
    expect(verify006Contracts()).toMatchObject({
      status: "PASS",
      queueOpenapiOperations: 11,
      approvalOpenapiOperations: 2,
      asyncapiChannels: 6,
      asyncapiMessages: 15,
    });
  });
});
