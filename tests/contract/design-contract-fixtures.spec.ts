import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

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
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith(".json") ? [path] : [];
      }),
    )
  )
    .flat()
    .sort();
}

function feature001SchemaForExample(file: string): string {
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
  throw new Error(`No schema mapping for ${name}`);
}

interface ExampleManifestCase {
  readonly fixture: string;
  readonly schema: string;
  readonly valid: boolean;
}

interface ExampleManifest {
  readonly schemaVersion: number;
  readonly cases: readonly ExampleManifestCase[];
}

async function schemaIdForManifestCase(
  manifestPath: string,
  schemaReference: string,
): Promise<string> {
  const [schemaPath, fragment = ""] = schemaReference.split("#", 2);
  if (!schemaPath) throw new Error(`Manifest schema path is empty: ${schemaReference}`);
  const schema = JSON.parse(await readFile(resolve(dirname(manifestPath), schemaPath), "utf8")) as {
    readonly $id?: string;
  };
  if (!schema.$id) throw new Error(`Manifest schema has no immutable id: ${schemaReference}`);
  return `${schema.$id}${fragment ? `#${fragment}` : ""}`;
}

describe("checked-in design contract registry", () => {
  it("contains every immutable schema from ordered feature contributions with canonical digests and resolved refs", async () => {
    expect(sha256("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      designContractContributions.slice(0, 2).map(({ key, order }) => ({ key, order })),
    ).toEqual([
      { key: "001-extension-kernel-local-skeleton", order: 100 },
      { key: "002-qa-manual-walking-skeleton", order: 200 },
    ]);
    expect(designContractContributions.map(({ order }) => order)).toEqual(
      [...designContractContributions.map(({ order }) => order)].sort(
        (left, right) => left - right,
      ),
    );

    const expectedPaths = (
      await Promise.all(
        designContractContributions.map(
          async ({ schemaRoot }) => await jsonFiles(resolve(root, schemaRoot)),
        ),
      )
    )
      .flat()
      .map((path) => relative(root, path));
    expect(schemaDocuments).toHaveLength(expectedPaths.length);
    expect(schemaDocuments.map(({ sourcePath }) => sourcePath)).toEqual(expectedPaths);
    expect(new Set(schemaDocuments.map(({ id }) => id))).toHaveProperty(
      "size",
      expectedPaths.length,
    );
    expect(
      schemaDocuments.filter(({ contributionOrder }) => contributionOrder <= 200),
    ).toHaveLength(80);

    for (const document of schemaDocuments) {
      const original = JSON.parse(await readFile(resolve(root, document.sourcePath), "utf8"));
      const digest = `sha256:${createHash("sha256").update(canonicalize(original)).digest("hex")}`;
      expect(document.digest).toBe(digest);
      expect(JSON.stringify(document.schema)).not.toMatch(/"\$ref":"https?:/u);
    }
  });

  it("validates Feature 001 fixtures and every manifest-mapped Feature 002 positive/negative vector", async () => {
    const registry = new OfflineSchemaRegistry();
    const feature001Examples = await jsonFiles(
      resolve(root, "specs/001-extension-kernel-local-skeleton/contracts/examples"),
    );
    expect(feature001Examples).toHaveLength(17);
    for (const file of feature001Examples) {
      const value = JSON.parse(await readFile(file, "utf8"));
      expect(
        () => registry.validateById(feature001SchemaForExample(file), value),
        `${dirname(file)}/${basename(file)}`,
      ).not.toThrow();
    }

    const manifestPath = resolve(root, designContractContributions[1].exampleManifest);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ExampleManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.cases).toHaveLength(185);
    expect(manifest.cases.filter(({ valid }) => valid)).toHaveLength(97);
    expect(manifest.cases.filter(({ valid }) => !valid)).toHaveLength(88);
    for (const contractCase of manifest.cases) {
      const fixture = JSON.parse(
        await readFile(resolve(dirname(manifestPath), contractCase.fixture), "utf8"),
      );
      const schemaId = await schemaIdForManifestCase(manifestPath, contractCase.schema);
      const validation = (): unknown => registry.validateById(schemaId, fixture);
      if (contractCase.valid) expect(validation, contractCase.fixture).not.toThrow();
      else expect(validation, contractCase.fixture).toThrow();
    }
  });

  it("keeps pinned YAML tooling and rejects digest drift, remote refs and same-id collisions", async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      readonly devDependencies: Readonly<Record<string, string>>;
    };
    const workspace = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
    expect(packageJson.devDependencies.yaml).toBe("2.9.0");
    expect(workspace).toContain("yaml: 2.9.0");

    const registry = new OfflineSchemaRegistry();
    expect(() =>
      registry.validate({
        schemaRef: {
          id: "urn:awp:schemas:sample:intake-form:v1",
          version: 1,
          digest: sha256("drift"),
        },
        value: { sampleName: "x", message: "ok" },
      }),
    ).toThrow(/digest mismatch/u);
    expect(
      () =>
        new OfflineSchemaRegistry([
          {
            contributionKey: "negative",
            contributionOrder: 999,
            sourcePath: "negative.json",
            id: "urn:awp:test:remote",
            digest: sha256({}),
            schema: { $id: "urn:awp:test:remote", $ref: "https://attacker.invalid/schema" },
          },
        ]),
    ).toThrow(/Remote schema reference/u);
    const document = schemaDocuments[0]!;
    expect(
      () =>
        new OfflineSchemaRegistry([
          ...schemaDocuments,
          { ...document, digest: sha256("different") },
        ]),
    ).toThrow(/collision/u);
  });
});
