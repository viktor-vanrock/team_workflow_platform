import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import {
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";

const root = resolve(
  import.meta.dirname,
  "../../../specs/005-gitlab-automated-validation/contracts",
);

const us1Schemas = Object.freeze([
  "urn:awp:schemas:005:automation-availability:v1",
  "urn:awp:schemas:005:automation-suite-binding:v1",
  "urn:awp:schemas:005:automation-suite-validation-report:v1",
  "urn:awp:schemas:005:automated-required-session:v1",
  "urn:awp:schemas:005:automated-test-session:v1",
  "urn:awp:schemas:005:automated-plan-item:v1",
  "urn:awp:schemas:005:automation-target-snapshot:v1",
] as const);

const us1Operations = Object.freeze([
  [
    "get",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/availability",
    "getQaAutomationAvailability",
  ],
  [
    "get",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings",
    "listAutomationSuiteBindings",
  ],
  [
    "post",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings",
    "createAutomationSuiteBinding",
  ],
  [
    "post",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings/{bindingId}/versions/{version}/validate",
    "validateAutomationSuiteBindingVersion",
  ],
  [
    "get",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings/{bindingId}/versions/{version}/validation-reports",
    "listAutomationSuiteValidationReports",
  ],
  [
    "post",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automation/suite-bindings/{bindingId}/versions/{version}/publish",
    "publishAutomationSuiteBindingVersion",
  ],
  [
    "post",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions",
    "createAutomatedTestSession",
  ],
  [
    "get",
    "/api/v1/workspaces/{workspaceId}/projects/{projectId}/qa/automated-sessions/{sessionId}",
    "getAutomatedTestSession",
  ],
] as const);

describe("Feature 005 US1 availability, Suite and Session contracts", () => {
  it("registers the seven US1 schemas in the offline immutable registry", () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    const ids = new Set(schemaDocuments.map(({ id }) => id));

    expect(us1Schemas.every((id) => ids.has(id))).toBe(true);
    expect(() =>
      registry.validateById(
        "urn:awp:schemas:005:automated-test-session:v1",
        JSON.parse(readFileSync(resolve(root, "examples/automated-session.local.v1.json"), "utf8")),
      ),
    ).not.toThrow();
  });

  it("keeps AUTOMATED wire schemas separate from the published MANUAL V1 schemas", () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    const automated = JSON.parse(
      readFileSync(resolve(root, "examples/automated-session.local.v1.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(() => registry.validateById("urn:awp:schemas:002:test-session:v1", automated)).toThrow();
    expect(() =>
      registry.validateById("urn:awp:schemas:005:automated-test-session:v1", {
        ...automated,
        mode: "MANUAL",
      }),
    ).toThrow();
  });

  it("publishes exactly the eight US1 operations with project-scoped OIDC authorization", () => {
    const document = parseDocument(
      readFileSync(resolve(root, "openapi/gitlab-automated-validation-api.v1.yaml"), "utf8"),
      { strict: true, uniqueKeys: true },
    ).toJS() as { paths: Record<string, Record<string, Record<string, unknown>>> };

    for (const [method, path, operationId] of us1Operations) {
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual([{ oidc: [] }]);
      expect(JSON.stringify(operation)).not.toMatch(
        /profileId|connectionId|secretRef|jobName|gitlabProjectId/iu,
      );
    }
  });
});
