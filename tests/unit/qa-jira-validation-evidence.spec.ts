import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import type { ConnectorCommand } from "../../packages/platform-core/src/index.ts";
import { jiraMappingRuntimeContent } from "../../packages/runtime-composition/src/jira/qa-connection-content.ts";
import {
  assertQaJiraConfiguredEndpoint,
  resolveAndPinQaJiraCommand,
  resolveQaJiraRequestCreateConfiguration,
  type RuntimeEnvironment,
} from "../../packages/runtime-composition/src/index.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const bindingRef = Object.freeze({ id: "binding", version: 2 } as const);
const profileRef = Object.freeze({ id: "profile", version: 2 } as const);

const environment: RuntimeEnvironment = Object.freeze({
  profile: "local",
  environmentScope: "LOCAL",
  environmentInput: { scope: "LOCAL", source: "CANONICAL", raw: "LOCAL" },
  composition: "qa-jira-local",
  databaseUrl: "postgresql://unused",
  mockHubUrl: "http://localhost:4010",
  identityIssuer: "https://fake-idp/",
  identityAudience: "awp",
  externalNetworkMode: "deny",
} as const);

describe("qa-jira exact-chain validation evidence", () => {
  it("reads schema-bound Jira mapping fields and preserves local top-level mappings", () => {
    const local = { authorityScopeKey: "qa.alpha", projectDiscriminator: "ALPHA" };
    const published = {
      connectorRef: { key: "jira.operational-authority" },
      mapping: { schemaRef: { id: "jira-mapping", version: "1" }, value: local },
    };
    expect(jiraMappingRuntimeContent(local)).toEqual(local);
    expect(jiraMappingRuntimeContent(published)).toMatchObject(local);
    expect(() => jiraMappingRuntimeContent({ mapping: { value: null } })).toThrow(
      "JIRA_MAPPING_CONFIGURATION_INVALID",
    );
  });
  it("restricts corporate Jira to the exact deployment scope and endpoint while retaining local origin checks", () => {
    const scope = { workspaceId, projectId };
    const corporate = {
      ...environment,
      profile: "non-local",
      deployment: {
        workspaceId,
        projectIds: [projectId],
        endpoints: [{ purpose: "jira", url: "https://jira.example.test" }],
      },
    } as unknown as RuntimeEnvironment;
    expect(() =>
      assertQaJiraConfiguredEndpoint(corporate, scope, "https://jira.example.test"),
    ).not.toThrow();
    expect(() =>
      assertQaJiraConfiguredEndpoint(corporate, scope, "https://other.example.test"),
    ).toThrow("JIRA_CORPORATE_EXACT_ENDPOINT_MISMATCH");
    expect(() =>
      assertQaJiraConfiguredEndpoint(
        corporate,
        { ...scope, projectId: "other" },
        "https://jira.example.test",
      ),
    ).toThrow("JIRA_CORPORATE_EXACT_ENDPOINT_MISMATCH");
    expect(() =>
      assertQaJiraConfiguredEndpoint(environment, scope, "http://localhost:4010/jira"),
    ).not.toThrow();
    expect(() =>
      assertQaJiraConfiguredEndpoint(environment, scope, "http://localhost:4011/jira"),
    ).toThrow("JIRA_LOCAL_EXACT_ENDPOINT_MISMATCH");
  });
  it("rejects a VALID report produced for different revision content", async () => {
    const manager = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM project_integration_binding_revisions")) {
          return [{ content: { entries: [] }, content_hash: "sha256:current-binding" }];
        }
        if (sql.includes("FROM integration_validation_reports")) {
          return [{ outcome: "VALID", content_hash: "sha256:previous-binding" }];
        }
        throw new Error(`UNEXPECTED_SQL:${sql}`);
      }),
    };
    const source = {
      transaction: vi.fn(
        async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
          await work(manager),
      ),
    } as unknown as DataSource;

    await expect(
      resolveQaJiraRequestCreateConfiguration(source, {
        workspaceId,
        projectId,
        bindingRef,
        profileRef,
        environment,
      }),
    ).rejects.toThrow("JIRA_BINDING_VALIDATION_EVIDENCE_STALE");
  });

  it("fails closed when an existing command pin differs from the resolved chain", async () => {
    const hashes = new Map([
      ["binding", "sha256:binding"],
      ["profile-primary", "sha256:profile-primary"],
      ["profile-context", "sha256:profile-context"],
      ["mapping-primary", "sha256:mapping-primary"],
      ["mapping-context", "sha256:mapping-context"],
      ["connection-primary", "sha256:connection-primary"],
      ["connection-context", "sha256:connection-context"],
    ]);
    const manager = {
      query: vi.fn(async (sql: string, parameters: readonly unknown[]) => {
        const id = String(parameters[1] ?? parameters[2] ?? "");
        if (sql.includes("FROM project_integration_binding_revisions")) {
          return [
            {
              content: {
                entries: [
                  {
                    logicalRole: "QA_REQUEST_AUTHORITY",
                    profileRef: { id: "profile-primary", version: 1 },
                  },
                  {
                    logicalRole: "SOURCE_CONTEXT",
                    profileRef: { id: "profile-context", version: 1 },
                  },
                ],
              },
              content_hash: hashes.get("binding"),
            },
          ];
        }
        if (sql.includes("FROM connector_profile_revisions")) {
          const suffix = id.endsWith("primary") ? "primary" : "context";
          return [
            {
              content: {
                connectorKey: "jira.operational-authority",
                mappingRef: { id: `mapping-${suffix}`, version: 1 },
                connectionRef: { id: `connection-${suffix}`, version: 1 },
              },
              content_hash: hashes.get(id),
            },
          ];
        }
        if (sql.includes("FROM connector_mapping_revisions")) {
          return [
            {
              content: { connectorKey: "jira.operational-authority" },
              content_hash: hashes.get(id),
            },
          ];
        }
        if (sql.includes("FROM connection_revisions")) {
          return [
            {
              content: {
                connectorKey: "jira.operational-authority",
                endpoint: "http://localhost:4010/jira/",
                adapterFamily: "jira-cloud-v3",
                adapterContractVersion: "1.0.0",
                projectId: "100",
              },
              content_hash: hashes.get(id),
            },
          ];
        }
        if (sql.includes("FROM integration_validation_reports")) {
          return [{ outcome: "VALID", content_hash: hashes.get(String(parameters[2])) }];
        }
        if (sql.startsWith("INSERT INTO connector_command_configuration_pins")) return [];
        if (sql.includes("FROM connector_command_configuration_pins")) {
          return [
            {
              sequence: parameters[1],
              purpose: Number(parameters[1]) === 0 ? "PRIMARY" : "AUXILIARY",
              requirement_key: "qa.alpha",
              logical_role: Number(parameters[1]) === 0 ? "QA_REQUEST_AUTHORITY" : "SOURCE_CONTEXT",
              project_integration_binding_ref: bindingRef,
              connector_profile_ref: {
                id: Number(parameters[1]) === 0 ? "profile-primary" : "profile-context",
                version: 1,
              },
              mapping_ref: {
                id: Number(parameters[1]) === 0 ? "mapping-primary" : "mapping-context",
                version: 1,
              },
              connection_ref: {
                id: Number(parameters[1]) === 0 ? "connection-primary" : "connection-context",
                version: 1,
              },
              content_hash: "sha256:conflicting-pin",
              adapter_family: "jira-cloud-v3",
              adapter_contract_version: "1.0.0",
              authority_namespace_hash: "sha256:conflicting-namespace",
            },
          ];
        }
        throw new Error(`UNEXPECTED_SQL:${sql}`);
      }),
    };
    const source = {
      transaction: vi.fn(
        async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
          await work(manager),
      ),
    } as unknown as DataSource;
    const command = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspaceId,
      projectId,
      bindingRef,
      profileRef: { id: "profile-primary", version: 1 },
      target: { authorityScopeKey: "qa.alpha" },
    } as unknown as ConnectorCommand;

    await expect(resolveAndPinQaJiraCommand(source, command, environment)).rejects.toThrow(
      "JIRA_COMMAND_CONFIGURATION_PIN_CONFLICT",
    );
  });
});
