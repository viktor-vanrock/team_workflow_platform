import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  designContractContributions,
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";
import { verify005Contracts } from "../../../tools/contracts/verify-005-contracts.mts";

type Json = Record<string, unknown>;
const workspace = resolve(import.meta.dirname, "../../..");
const contracts = resolve(workspace, "specs/005-gitlab-automated-validation/contracts");
const methods = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Json;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function digest(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function operations(document: Json): readonly Json[] {
  return Object.values(document.paths as Json).flatMap((pathItem) =>
    Object.entries(pathItem as Json)
      .filter(([method]) => methods.has(method))
      .map(([, operation]) => operation as Json),
  );
}

describe("Feature 005 registry/API/event snapshot parity", () => {
  it("keeps generated registry and OpenAPI snapshots byte-current", () => {
    for (const [script, expected] of [
      ["tools/contracts/build-registry.mts", "Contract registry snapshot is current"],
      ["tools/contracts/build-openapi-snapshots.mts", "OpenAPI snapshots verified"],
    ] as const) {
      const result = spawnSync(process.execPath, [script, "--check"], {
        cwd: workspace,
        encoding: "utf8",
        env: process.env,
      });
      expect(`${result.stdout}\n${result.stderr}`).toContain(expected);
      expect(result.status).toBe(0);
    }
  });

  it("registers one exact order-500 contribution with 31 immutable byte-pinned schemas", () => {
    const contribution = designContractContributions.filter(({ order }) => order === 500);
    expect(contribution).toEqual([
      expect.objectContaining({
        key: "005-gitlab-automated-validation",
        schemaRoot: "specs/005-gitlab-automated-validation/contracts/schemas",
        openapiDocuments: [
          "specs/005-gitlab-automated-validation/contracts/openapi/gitlab-automated-validation-api.v1.yaml",
        ],
        asyncapiDocuments: [
          "specs/005-gitlab-automated-validation/contracts/asyncapi/gitlab-automated-validation-events.v1.yaml",
        ],
      }),
    ]);
    expect(
      designContractContributions.filter(({ order }) => order <= 500).map(({ order }) => order),
    ).toEqual([100, 200, 300, 400, 500]);

    const feature = schemaDocuments.filter(
      ({ contributionOrder }) => contributionOrder === contribution[0]!.order,
    );
    expect(feature).toHaveLength(31);
    expect(new Set(feature.map(({ id }) => id)).size).toBe(31);
    for (const document of feature) {
      const source = JSON.parse(
        readFileSync(resolve(workspace, document.sourcePath), "utf8"),
      ) as Json;
      expect(document.id).toBe(source.$id);
      expect(document.digest).toBe(digest(canonical(source)));
    }
    expect(() => new OfflineSchemaRegistry(schemaDocuments)).not.toThrow();
  });

  it("pins every API operation and AsyncAPI payload schema to the generated registry", () => {
    const apiDesign = parse(
      readFileSync(resolve(contracts, "openapi/gitlab-automated-validation-api.v1.yaml"), "utf8"),
    ) as Json;
    const apiSnapshot = JSON.parse(
      readFileSync(resolve(workspace, "apps/api/openapi.generated.json"), "utf8"),
    ) as Json;
    const designOperationIds = operations(apiDesign)
      .map(({ operationId }) => String(operationId))
      .sort();
    const snapshotOperationIds = new Set(
      operations(apiSnapshot).map(({ operationId }) => String(operationId)),
    );
    expect(designOperationIds).toHaveLength(21);
    expect(new Set(designOperationIds).size).toBe(21);
    expect(designOperationIds.every((id) => snapshotOperationIds.has(id))).toBe(true);

    const asyncApi = parse(
      readFileSync(
        resolve(contracts, "asyncapi/gitlab-automated-validation-events.v1.yaml"),
        "utf8",
      ),
    ) as Json;
    const messages = ((asyncApi.components as Json).messages ?? {}) as Json;
    expect(Object.keys(messages)).toHaveLength(6);
    const registry = new Map(schemaDocuments.map((document) => [document.id as string, document]));
    for (const message of Object.values(messages) as Json[]) {
      const properties = (((message.payload as Json).allOf as Json[])[1]!.properties ?? {}) as Json;
      const schemaRef = ((properties.payloadSchemaRef as Json).properties ?? {}) as Json;
      const id = String((schemaRef.id as Json).const);
      const pinnedDigest = String((schemaRef.digest as Json).const);
      expect(registry.get(id)?.digest).toBe(pinnedDigest);
    }

    for (const snapshotPath of [
      "apps/api/openapi.generated.json",
      "apps/mock-hub/openapi.generated.json",
    ]) {
      const snapshot = JSON.parse(readFileSync(resolve(workspace, snapshotPath), "utf8")) as Json;
      for (const [sourcePath, pinnedDigest] of Object.entries(
        snapshot["x-awp-source-digests"] as Record<string, string>,
      )) {
        expect(digest(readFileSync(resolve(workspace, sourcePath)))).toBe(pinnedDigest);
      }
    }
  });

  it("keeps the exact positive/negative example set and semantic digest vectors valid", () => {
    expect(readdirSync(resolve(contracts, "examples")).sort()).toEqual([
      "artifacts",
      "automated-session.local.v1.json",
      "gitlab-connection-configuration.local.v1.json",
      "gitlab-pilot-metadata.local.v1.json",
      "negative",
      "pipeline-result.pass.v1.json",
    ]);
    expect(readdirSync(resolve(contracts, "examples/negative")).sort()).toEqual([
      "automated-session.unknown-provider-authority.v1.json",
      "automation-availability.full-missing-capability.v1.json",
      "automation-target-snapshot.missing-resource-ref.v1.json",
      "manifest.v1.json",
      "pipeline-result.pass-with-infra-code.v1.json",
    ]);
    expect(verify005Contracts(workspace)).toMatchObject({
      status: "PASS",
      positiveExamples: 4,
      negativeExamples: 4,
      semanticVectors: 2,
      errors: [],
    });
    expect(
      schemaDocuments.find(({ id }) => id === "urn:awp:schemas:005:gitlab-pipeline-result:v1")
        ?.digest,
    ).toBe("sha256:d668c14c37a8636b71d9c03405312b7d01586a2e7e6a51996e3b067855bcb678");
  });

  it("retains the published Feature 002 MANUAL wire contracts without widening them", () => {
    const pins = [
      [
        "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/test-session.v1.schema.json",
        "urn:awp:schemas:qa:test-session:v1",
        "sha256:7a29648a65a108db76fb19ef1a5e03748ec9fd182e71c334414baaf287fb8192",
      ],
      [
        "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/plan-item.v1.schema.json",
        "urn:awp:schemas:qa:plan-item:v1",
        "sha256:3ac88a1f69b99900d506971bb51a8cfa4f232f8aeb40e758b4476da1f92459b8",
      ],
    ] as const;
    for (const [sourcePath, id, expectedDigest] of pins) {
      const source = JSON.parse(readFileSync(resolve(workspace, sourcePath), "utf8")) as Json;
      expect(source.$id).toBe(id);
      expect((source.properties as Json).mode as Json).toEqual({ const: "MANUAL" });
      expect(JSON.stringify(source)).not.toContain("AUTOMATED");
      expect(schemaDocuments.find((document) => document.id === id)).toMatchObject({
        contributionOrder: 200,
        sourcePath,
        digest: expectedDigest,
      });
    }
  });
});
