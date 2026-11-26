import { describe, expect, it, vi } from "vitest";
import {
  designContractRegistry,
  OfflineSchemaRegistry,
  sha256,
} from "../../../packages/platform-contracts/src/index.ts";
import {
  assertCorporatePublishedSuiteParameters,
  validateCorporateSuiteParameters,
} from "../../../packages/runtime-composition/src/gitlab/corporate-parameter-schema.ts";

const id = "urn:awp:schemas:qa:automation-parameters:fixture:v1";
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: id,
  type: "object",
  properties: { BUILD_REF: { type: "string", minLength: 1 } },
  required: ["BUILD_REF"],
  additionalProperties: false,
} as const;
const digest = sha256(schema);
const registry = new OfflineSchemaRegistry([
  { contributionKey: "test", contributionOrder: 1, sourcePath: "fixture", id, digest, schema },
]);
const ref = { id, version: 1, contentHash: digest };

describe("corporate suite parameter schema", () => {
  it("validates the shipped v1 schema using its pinned content hash", () => {
    const shippedId = "urn:awp:schemas:qa:automation-parameters:build-ref:v1";
    const document = designContractRegistry.document(shippedId);
    const shipped = { id: shippedId, version: 1, contentHash: document.digest };
    expect(document.digest).toBe(
      "sha256:c989e36d3d49642eb82af395f93edc6f67cfe32ebc02b4b9f63b553bf5d75e63",
    );
    expect(sha256(document.schema as never)).toBe(document.digest);
    expect(() =>
      validateCorporateSuiteParameters(shipped, { BUILD_REF: "pipeline:101" }),
    ).not.toThrow();
    for (const value of [
      {},
      { BUILD_REF: "" },
      { BUILD_REF: "  " },
      { BUILD_REF: "a\nb" },
      { BUILD_REF: "pipeline:101", extra: true },
    ])
      expect(() => validateCorporateSuiteParameters(shipped, value)).toThrow(
        "CORPORATE_GITLAB_PARAMETERS_INVALID",
      );
    expect(() =>
      validateCorporateSuiteParameters(
        { ...shipped, contentHash: sha256("tampered") },
        { BUILD_REF: "pipeline:101" },
      ),
    ).toThrow("CORPORATE_GITLAB_PARAMETER_SCHEMA_MISMATCH");
  });
  it("validates parameters against the exact bundled schema and rejects unknown inputs", () => {
    expect(() =>
      validateCorporateSuiteParameters(ref, { BUILD_REF: "pipeline:1" }, registry),
    ).not.toThrow();
    expect(() =>
      validateCorporateSuiteParameters(ref, { BUILD_REF: "pipeline:1", extra: true }, registry),
    ).toThrow("CORPORATE_GITLAB_PARAMETERS_INVALID");
    expect(() => validateCorporateSuiteParameters({ ...ref, version: 2 }, {}, registry)).toThrow(
      "CORPORATE_GITLAB_PARAMETER_SCHEMA_INVALID",
    );
    expect(() =>
      validateCorporateSuiteParameters({ ...ref, contentHash: sha256("other") }, {}, registry),
    ).toThrow("CORPORATE_GITLAB_PARAMETER_SCHEMA_MISMATCH");
    expect(() =>
      validateCorporateSuiteParameters(
        { ...ref, id: id.replace("fixture", "missing") },
        {},
        registry,
      ),
    ).toThrow("CORPORATE_GITLAB_PARAMETER_SCHEMA_UNAVAILABLE");
  });
  it("recomputes the schema hash instead of trusting the registry metadata", () => {
    const wrongDigest = sha256("wrong");
    const corrupted = new OfflineSchemaRegistry([
      {
        contributionKey: "test",
        contributionOrder: 1,
        sourcePath: "fixture",
        id,
        digest: wrongDigest,
        schema,
      },
    ]);
    expect(() =>
      validateCorporateSuiteParameters(
        { ...ref, contentHash: wrongDigest },
        { BUILD_REF: "pipeline:1" },
        corrupted,
      ),
    ).toThrow("CORPORATE_GITLAB_PARAMETER_SCHEMA_MISMATCH");
  });
  it("rejects external schema references that are not covered by the pinned hash", () => {
    const dependencyId = "urn:awp:schemas:qa:automation-parameters:dependency:v1";
    const dependency = { $schema: schema.$schema, $id: dependencyId, type: "string" } as const;
    const indirect = { ...schema, properties: { BUILD_REF: { $ref: dependencyId } } } as const;
    const indirectDigest = sha256(indirect);
    const indirectRegistry = new OfflineSchemaRegistry([
      {
        contributionKey: "test",
        contributionOrder: 1,
        sourcePath: "fixture",
        id,
        digest: indirectDigest,
        schema: indirect,
      },
      {
        contributionKey: "test",
        contributionOrder: 1,
        sourcePath: "dependency",
        id: dependencyId,
        digest: sha256(dependency),
        schema: dependency,
      },
    ]);
    expect(() =>
      validateCorporateSuiteParameters(
        { ...ref, contentHash: indirectDigest },
        { BUILD_REF: "pipeline:1" },
        indirectRegistry,
      ),
    ).toThrow("CORPORATE_GITLAB_PARAMETER_SCHEMA_MISMATCH");
  });
  it("does not accept a schema pin different from the published Suite", async () => {
    const content = { parameterSchemaRef: ref };
    const parameters = { BUILD_REF: "pipeline:1" };
    const query = vi.fn().mockResolvedValue([{ content, content_hash: sha256(content) }]);
    await expect(
      assertCorporatePublishedSuiteParameters(
        { query } as never,
        { workspaceId: "w", projectId: "p" },
        {
          suiteKey: "suite-key",
          suiteBindingRef: { id: "suite", version: 1 },
          suiteBindingHash: sha256(content),
          parameterSchemaRef: { ...ref, contentHash: sha256("other") },
          acceptedParameters: parameters,
          parametersHash: sha256(parameters),
        },
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_SUITE_CONFIGURATION_STALE");
  });
  it("validates parameters only after resolving the exact published Suite", async () => {
    const content = { parameterSchemaRef: ref };
    const parameters = { BUILD_REF: "pipeline:1" };
    const query = vi.fn().mockResolvedValue([{ content, content_hash: sha256(content) }]);
    const suite = {
      suiteKey: "suite-key",
      suiteBindingRef: { id: "suite", version: 1 },
      suiteBindingHash: sha256(content),
      parameterSchemaRef: ref,
      acceptedParameters: parameters,
      parametersHash: sha256(parameters),
    };
    await expect(
      assertCorporatePublishedSuiteParameters(
        { query } as never,
        { workspaceId: "w", projectId: "p" },
        suite,
        registry,
      ),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("v.state='PUBLISHED'"), [
      "w",
      "p",
      "suite",
      1,
      "suite-key",
    ]);
    query.mockResolvedValueOnce([]);
    await expect(
      assertCorporatePublishedSuiteParameters(
        { query } as never,
        { workspaceId: "w", projectId: "p" },
        suite,
        registry,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_SUITE_CONFIGURATION_STALE");
  });
  it("accepts the shipped schema pinned by the current published Suite without a fixture fallback", async () => {
    const id = "urn:awp:schemas:qa:automation-parameters:build-ref:v1";
    const parameterSchemaRef = { id, version: 1, contentHash: designContractRegistry.digest(id) };
    const content = { parameterSchemaRef };
    const acceptedParameters = { BUILD_REF: "pipeline:101" };
    const suite = {
      suiteKey: "suite-key",
      suiteBindingRef: { id: "suite", version: 1 },
      suiteBindingHash: sha256(content),
      parameterSchemaRef,
      acceptedParameters,
      parametersHash: sha256(acceptedParameters),
    };
    const query = vi.fn().mockResolvedValue([{ content, content_hash: suite.suiteBindingHash }]);
    await expect(
      assertCorporatePublishedSuiteParameters(
        { query } as never,
        { workspaceId: "w", projectId: "p" },
        suite,
      ),
    ).resolves.toBeUndefined();
    const invalid = {
      ...suite,
      acceptedParameters: { ...acceptedParameters, extra: "injected" },
      parametersHash: sha256({ ...acceptedParameters, extra: "injected" }),
    };
    await expect(
      assertCorporatePublishedSuiteParameters(
        { query } as never,
        { workspaceId: "w", projectId: "p" },
        invalid,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_PARAMETERS_INVALID");
  });
});
