import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import { schemaDocuments } from "../../../packages/platform-contracts/src/index.ts";

const contracts = resolve(
  import.meta.dirname,
  "../../../specs/005-gitlab-automated-validation/contracts",
);

describe("Feature 005 US2 trigger contracts", () => {
  it("registers immutable Attempt/status and test-executor trigger/status schemas", () => {
    const ids = new Set<string>(schemaDocuments.map(({ id }) => id));
    for (const id of [
      "urn:awp:schemas:005:automation-attempt:v1",
      "urn:awp:schemas:005:automation-attempt-status-revision:v1",
      "urn:awp:schemas:005:capability:test-executor-trigger-status:v1",
    ])
      expect(ids.has(id), id).toBe(true);
  });

  it("publishes exactly list, launch, detail, and status operations with OIDC and launch concurrency headers", () => {
    const openapi = parseDocument(
      readFileSync(resolve(contracts, "openapi/gitlab-automated-validation-api.v1.yaml"), "utf8"),
      { strict: true, uniqueKeys: true },
    ).toJS() as Readonly<{
      paths: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>;
      components: Readonly<{
        schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      }>;
    }>;
    const base =
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}/attempts";
    const operations = [
      ["get", base, "listAutomationAttempts"],
      ["post", base, "launchAutomationAttempt"],
      ["get", `${base}/{attemptId}`, "getAutomationAttempt"],
      ["get", `${base}/{attemptId}/status-revisions`, "listAutomationAttemptStatusRevisions"],
    ] as const;
    for (const [method, path, operationId] of operations) {
      const operation = openapi.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual([{ oidc: [] }]);
    }
    const launch = openapi.paths[base]?.post;
    expect(JSON.stringify(launch)).toContain("Idempotency-Key");
    expect(JSON.stringify(launch)).toContain("IfMatch");
    expect(
      Object.keys(
        openapi.components.schemas.LaunchAttemptRequest?.properties as Record<string, unknown>,
      ),
    ).toEqual(["confirmation"]);
  });

  it("keeps provider authority out of launch input and closes every trigger/lookup message", () => {
    const launchSchema = parseDocument(
      readFileSync(resolve(contracts, "openapi/gitlab-automated-validation-api.v1.yaml"), "utf8"),
      { strict: true, uniqueKeys: true },
    ).toJS() as Readonly<{
      components: Readonly<{
        schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      }>;
    }>;
    const request = launchSchema.components.schemas.LaunchAttemptRequest!;
    expect(request.additionalProperties).toBe(false);
    expect(JSON.stringify(request)).not.toMatch(
      /profileId|connectionId|secretRef|variables|jobName|numericProjectId|pipelineId/iu,
    );
    const executor = JSON.parse(
      readFileSync(
        resolve(contracts, "schemas/test-executor-trigger-status.v1.schema.json"),
        "utf8",
      ),
    ) as Readonly<{ $defs: Readonly<Record<string, Readonly<Record<string, unknown>>>> }>;
    for (const definition of Object.values(executor.$defs))
      expect(definition.additionalProperties).toBe(false);
  });
});
