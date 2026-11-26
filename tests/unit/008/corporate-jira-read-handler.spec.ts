import { describe, expect, it, vi } from "vitest";
import { createCorporateJiraAuthoritativeReadHandler } from "../../../packages/runtime-composition/src/jira/corporate-authoritative-read-handler.ts";
import { integrationConfigurationHash } from "../../../packages/runtime-composition/src/onboarding/configuration-hash.ts";
import { TypeOrmOperationalAuthorityRepository } from "../../../packages/platform-persistence-typeorm/src/operational-authority.repository.ts";

describe("corporate Jira read authority", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  it("rejects another project before querying or contacting Jira", async () => {
    const query = vi.fn();
    const jira = vi.fn();
    const handler = createCorporateJiraAuthoritativeReadHandler({
      source: { isInitialized: true, manager: { query } },
      environment,
      grants: [],
      factories: { jira },
    } as never);
    await expect(
      handler.read({ workspaceId: "workspace", projectId: "other", envelope: {} } as never),
    ).rejects.toThrow("CORPORATE_JIRA_READ_SCOPE_DENIED");
    expect(query).not.toHaveBeenCalled();
    expect(jira).not.toHaveBeenCalled();
  });
  it("rejects unsupported jobs instead of trusting webhook payloads", async () => {
    const query = vi.fn();
    const handler = createCorporateJiraAuthoritativeReadHandler({
      source: { isInitialized: true, manager: { query } },
      environment,
      grants: [],
      factories: {},
    } as never);
    await expect(
      handler.read({
        workspaceId: "workspace",
        projectId: "project",
        envelope: { kind: "IMPORT_DISCOVERY", connectionId: "id", externalEntityId: "issue" },
      } as never),
    ).rejects.toThrow("CORPORATE_JIRA_READ_JOB_UNSUPPORTED");
    expect(query).not.toHaveBeenCalled();
  });
  it("reads the configured issue and atomically applies its mapped status", async () => {
    const profile = {
      schemaVersion: 1,
      logicalRole: "QA_REQUEST_AUTHORITY",
      project: { id: "100" },
      identityPolicy: { requesterMode: "VERIFIED_REPORTER" },
      projectDiscriminatorFieldId: "customfield_123",
      statusMappings: [
        { rawStatusId: "17", rawStatusName: "Working", normalizedStatus: "IN_PROGRESS" },
      ],
      priorityMappings: [{ priorityId: "4", priorityName: "Normal", normalizedKey: "MEDIUM" }],
      mappingRef: { id: "mapping", version: 1 },
      connectionRef: { id: "connection", version: 1 },
    };
    const mapping = { projectDiscriminator: "project-key" },
      connection = { endpoint: "https://jira.example" },
      binding = { entries: [] };
    const profileRef = {
      id: "profile",
      version: 1,
      contentHash: integrationConfigurationHash("connector_profile", profile),
    };
    const mappingHash = integrationConfigurationHash("connector_mapping", mapping);
    const connectionRef = {
      id: "connection",
      version: 1,
      contentHash: integrationConfigurationHash("connection", connection),
    };
    const bindingRef = {
      id: "binding",
      version: 1,
      contentHash: integrationConfigurationHash("project_integration_binding", binding),
    };
    const row = {
      id: "operational",
      work_item_id: "work",
      project_integration_binding_ref: { id: bindingRef.id, version: bindingRef.version },
      connector_profile_ref: { id: profileRef.id, version: profileRef.version },
      connection_ref: { id: connectionRef.id, version: connectionRef.version },
      mapping_ref: { id: "mapping", version: 1 },
      profile_content: profile,
      profile_hash: profileRef.contentHash,
      mapping_content: mapping,
      mapping_hash: mappingHash,
      connection_content: connection,
      binding_content: binding,
      adapter_family: "jira-cloud-v3",
      adapter_contract_version: "1.0.0",
      sync_state: "SYNCED",
      freshness_state: "CURRENT",
    };
    const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => [row]);
    const request = vi.fn(async () => ({
      json: async () => ({
        id: "10",
        key: "QA-10",
        fields: {
          project: { id: "100" },
          reporter: { accountId: "jira-user" },
          updated: "2026-01-01T00:00:00Z",
          customfield_123: "project-key",
          status: { id: "17", name: "Working" },
        },
      }),
    }));
    const reduce = vi
      .spyOn(TypeOrmOperationalAuthorityRepository.prototype, "reduceObservation")
      .mockResolvedValue({
        disposition: "APPLIED",
        projection: { normalizedStatus: "IN_PROGRESS", revision: 1 },
      } as never);
    const handler = createCorporateJiraAuthoritativeReadHandler({
      source: { isInitialized: true, manager: { query } },
      environment,
      grants: [
        {
          binding: {
            provider: "JIRA",
            workspaceId: "workspace",
            projectId: "project",
            ref: { id: "grant" },
            profileRef,
            connectionRef,
          },
          integrationBindingRef: bindingRef,
        },
      ],
      factories: { jira: () => ({ request }) },
    } as never);
    const apply = await handler.read({
      id: "event",
      workspaceId: "workspace",
      projectId: "project",
      envelope: { kind: "BOUND_POLL", connectionId: "connection", externalEntityId: "10" },
    } as never);
    const writes = vi.fn(async () => []);
    await apply({
      query: async (sql: string, params: readonly unknown[]) =>
        sql.startsWith("SELECT b.*") ? await query(sql, params) : await writes(),
    } as never);
    expect(request).toHaveBeenCalledOnce();
    expect(reduce.mock.calls[0]?.[2]).toMatchObject({
      externalEntityId: "10",
      normalizedStatus: "IN_PROGRESS",
      requester: { externalPrincipalId: "jira-user" },
    });
    expect(writes).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
