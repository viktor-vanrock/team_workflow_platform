import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  designContractContributions,
  OfflineSchemaRegistry,
  schemaDocuments,
  sha256,
} from "../../packages/platform-contracts/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
async function jsonFiles(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith(".json") ? [path] : [];
      }),
    )
  )
    .flat()
    .sort();
}
function schemaForExample(file: string): string {
  const name = basename(file);
  const exact: Record<string, string> = {
    "dummy-pack-manifest.json": "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    "sample-mock-connector-manifest.json": "urn:awp:contracts:extensions:connector-manifest:v1",
    "sample-record-capability.json": "urn:awp:contracts:extensions:capability-contract:v1",
    "sample-record-published.json": "urn:awp:contracts:events:event-envelope:v1",
    "sample-command-intent.json": "urn:awp:contracts:commands:capability-command-intent:v1",
    "sample-external-command.json": "urn:awp:contracts:commands:external-command-envelope:v1",
    "sample-external-command-job.json": "urn:awp:contracts:commands:external-command-job:v1",
    "sample-connection.json": "urn:awp:contracts:integration:connection:v1",
    "sample-connector-mapping-version.json":
      "urn:awp:contracts:integration:connector-mapping-version:v1",
    "sample-profile-version.json": "urn:awp:contracts:integration:connector-profile-version:v1",
    "sample-project-binding-version.json":
      "urn:awp:contracts:integration:project-integration-binding-version:v1",
  };
  if (exact[name]) return exact[name];
  if (name.includes("approval")) return "urn:awp:contracts:commands:approval-subject:v1";
  if (name.includes("validation-report"))
    return "urn:awp:contracts:integration:validation-report:v1";
  throw new Error(`Unmapped contract example ${name}`);
}

describe("complete offline contract registry", () => {
  it("loads every immutable local schema from ordered additive contributions through the runtime registry", async () => {
    const files = (
      await Promise.all(
        designContractContributions.map(
          async ({ schemaRoot }) => await jsonFiles(resolve(root, schemaRoot)),
        ),
      )
    ).flat();
    expect(schemaDocuments).toHaveLength(files.length);
    expect(new Set(schemaDocuments.map(({ id }) => id))).toHaveProperty("size", files.length);
    expect(
      schemaDocuments.filter(({ contributionOrder }) => contributionOrder <= 200),
    ).toHaveLength(80);
    const contributionRoots = new Map(
      designContractContributions.map(({ key, schemaRoot }) => [key, `${schemaRoot}/`]),
    );
    for (const document of schemaDocuments) {
      expect(
        document.sourcePath.startsWith(
          contributionRoots.get(document.contributionKey) ?? "missing contribution",
        ),
      ).toBe(true);
      const original = JSON.parse(await readFile(resolve(root, document.sourcePath), "utf8"));
      expect(document.digest).toBe(
        `sha256:${createHash("sha256").update(canonicalize(original)).digest("hex")}`,
      );
      const refs = JSON.stringify(document.schema).match(/"\$ref":"([^"]+)"/gu) ?? [];
      expect(refs.every((ref) => ref.includes("urn:awp:") || ref.includes('"$ref":"#'))).toBe(true);
    }
  });

  it("validates all 17 positive examples and rejects a negative vector for every schema", async () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    const examples = await jsonFiles(
      resolve(root, "specs/001-extension-kernel-local-skeleton/contracts/examples"),
    );
    expect(examples).toHaveLength(17);
    for (const file of examples) {
      const example = JSON.parse(await readFile(file, "utf8"));
      expect(
        () => registry.validateById(schemaForExample(file), example),
        basename(file),
      ).not.toThrow();
    }
    for (const document of schemaDocuments) {
      const schema = document.schema as Record<string, unknown>;
      const constrainsRoot = [
        "type",
        "$ref",
        "oneOf",
        "anyOf",
        "allOf",
        "not",
        "enum",
        "const",
      ].some((key) => key in schema);
      const targets = constrainsRoot
        ? [document.id]
        : Object.keys((schema.$defs as Record<string, unknown> | undefined) ?? {}).map(
            (key) => `${document.id}#/$defs/${key}`,
          );
      expect(
        targets.length,
        `${document.id} must expose a root constraint or typed definitions`,
      ).toBeGreaterThan(0);
      for (const target of targets)
        expect(() => registry.validateById(target, null), target).toThrow();
    }
  });

  it("rejects remote refs, immutable-ref drift, unknown fields and same-id collisions", () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    expect(() =>
      registry.validate({
        schemaRef: {
          id: "urn:awp:schemas:sample:intake-form:v1",
          version: 1,
          digest: sha256("drift"),
        },
        value: { title: "x", message: "ok" },
      }),
    ).toThrow(/digest mismatch/u);
    expect(() =>
      registry.validateById("urn:awp:schemas:sample:intake-form:v1", {
        title: "x",
        message: "ok",
        token: "forbidden",
      }),
    ).toThrow();
    expect(
      () =>
        new OfflineSchemaRegistry([
          {
            contributionKey: "negative",
            contributionOrder: 999,
            sourcePath: "negative.json",
            id: "urn:awp:test:remote",
            digest: sha256({}),
            schema: { $id: "urn:awp:test:remote", $ref: "https://invalid.example/schema" },
          },
        ]),
    ).toThrow(/Remote schema reference/u);
    const first = schemaDocuments[0]!;
    expect(
      () =>
        new OfflineSchemaRegistry([...schemaDocuments, { ...first, digest: sha256("collision") }]),
    ).toThrow(/collision/u);
  });
});
