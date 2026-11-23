import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  designContractContributions,
  OfflineSchemaRegistry,
  schemaDocumentById,
  schemaDocuments,
} from "../../packages/platform-contracts/src/index.ts";
import {
  coreOnlyExtensionCandidates,
  nonLocalExtensionCandidates,
} from "../../packages/runtime-composition/src/index.ts";
import { fixtureJson } from "../support/fixture-value.ts";

const root = resolve(import.meta.dirname, "../..");
const featureKey = "002-qa-manual-walking-skeleton";
const operationalPrefix = "urn:awp:schemas:operational-work-item:";

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown): JsonObject {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  return value as JsonObject;
}

function references(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as JsonObject).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : references(child),
  );
}

function generatedSchema(id: string): JsonObject {
  const document = schemaDocumentById.get(id);
  expect(document, `generated registry must contain ${id}`).toBeDefined();
  return document!.schema;
}

describe("Feature 002 compiled design contract", () => {
  it("builds a complete ordered catalog with canonical immutable ids and digests", async () => {
    expect(
      designContractContributions.slice(0, 2).map(({ key, order }) => ({ key, order })),
    ).toEqual([
      { key: "001-extension-kernel-local-skeleton", order: 100 },
      { key: featureKey, order: 200 },
    ]);

    const featureDocuments = schemaDocuments.filter(
      ({ contributionKey }) => contributionKey === featureKey,
    );
    expect(featureDocuments).toHaveLength(49);
    expect(new Set(featureDocuments.map(({ id }) => id))).toHaveProperty("size", 49);
    expect(featureDocuments.every(({ contributionOrder }) => contributionOrder === 200)).toBe(true);

    for (const document of featureDocuments) {
      const source = JSON.parse(
        await readFile(resolve(root, document.sourcePath), "utf8"),
      ) as JsonObject;
      expect(document.id).toMatch(/^urn:awp:[a-z0-9:.-]+:v1$/u);
      expect(source.$id).toBe(document.id);
      expect(document.schema.$id).toBe(document.id);
      expect(document.digest).toBe(
        `sha256:${createHash("sha256")
          .update(canonicalize(fixtureJson(source)))
          .digest("hex")}`,
      );
    }

    expect(() => new OfflineSchemaRegistry(schemaDocuments)).not.toThrow();
  });

  it("resolves every generated Feature 002 reference offline through immutable ids", () => {
    const knownIds = new Set<string>(schemaDocuments.map(({ id }) => id));
    const featureDocuments = schemaDocuments.filter(
      ({ contributionKey }) => contributionKey === featureKey,
    );

    for (const document of featureDocuments) {
      for (const reference of references(document.schema)) {
        if (reference.startsWith("#")) continue;
        expect(reference, `${document.id} contains a mutable or relative reference`).toMatch(
          /^urn:awp:/u,
        );
        expect(knownIds.has(reference.split("#", 1)[0]!)).toBe(true);
      }
    }
  });

  it("keeps operational-work-item@1.0.0 closed to exactly three writes", async () => {
    const capabilities = await readFile(
      resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/capabilities.md"),
      "utf8",
    );
    const operationRows = [...capabilities.matchAll(/^\| `([^`]+)` \| WRITE \|/gmu)].map(
      (match) => match[1],
    );
    expect(operationRows).toEqual(["request.create", "request.transition", "defect.create"]);

    const inputSchemaIds = [
      `${operationalPrefix}request-create:v1`,
      `${operationalPrefix}request-transition:v1`,
      `${operationalPrefix}defect-create:v1`,
    ];
    expect(inputSchemaIds.map((id) => schemaDocumentById.get(id)?.id)).toEqual(inputSchemaIds);

    const resultProperties = object(generatedSchema(`${operationalPrefix}result:v1`).properties);
    expect(object(resultProperties.operation).enum).toEqual(operationRows);
    expect(JSON.stringify(resultProperties.operation)).not.toMatch(/read[-_. ]?back/iu);
  });

  it("preserves an empty Core-only composition after compiling QA design contracts", () => {
    expect(coreOnlyExtensionCandidates).toEqual([]);
    expect(nonLocalExtensionCandidates).toEqual([]);
    expect(JSON.stringify(coreOnlyExtensionCandidates)).not.toMatch(/qa[.:_-]/iu);
  });
});
