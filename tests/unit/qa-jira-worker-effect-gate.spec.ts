import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import {
  type CommandConfigurationPin,
  ConfigurationPinSet,
  type ConnectorCommand,
} from "../../packages/platform-core/src/index.ts";
import {
  type QaJiraResolvedPins,
  revalidateQaJiraRequestCreateEffect,
} from "../../packages/runtime-composition/src/index.ts";

const at = new Date("2026-08-31T12:00:00.000Z");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const ref = (id: string, version = 1) => Object.freeze({ id, version } as const);
const digest = (seed: string): `sha256:${string}` => `sha256:${seed.padEnd(64, "0").slice(0, 64)}`;

function pin(
  sequence: number,
  purpose: "PRIMARY" | "AUXILIARY",
  logicalRole: string,
): CommandConfigurationPin {
  return Object.freeze({
    sequence,
    purpose,
    logicalRole,
    bindingRef: ref("binding", 2),
    profileRef: ref(`profile-${sequence}`, 2),
    mappingRef: ref(`mapping-${sequence}`),
    connectionRef: ref(`connection-${sequence}`),
    contentHash: digest(`pin-${sequence}`),
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
    authorityNamespaceHash: digest(`namespace-${sequence}`),
  } as const);
}

function resolved(): QaJiraResolvedPins {
  const primary = pin(0, "PRIMARY", "QA_REQUEST_AUTHORITY");
  const auxiliary = pin(1, "AUXILIARY", "SOURCE_CONTEXT");
  const content = Object.freeze({ connectorKey: "jira.operational-authority" } as const);
  return Object.freeze({
    pinSet: ConfigurationPinSet.create([primary, auxiliary]),
    entries: Object.freeze([
      Object.freeze({
        pin: primary,
        profileContent: content,
        mappingContent: content,
        connectionContent: content,
      } as const),
      Object.freeze({
        pin: auxiliary,
        profileContent: content,
        mappingContent: content,
        connectionContent: content,
      } as const),
    ] as const),
    bindingRef: primary.bindingRef,
    bindingContent: content,
    profileRef: primary.profileRef,
    profileContent: content,
    mappingRef: primary.mappingRef,
    mappingContent: content,
    connectionRef: primary.connectionRef,
    connectionContent: content,
    connectionHeaderId: primary.connectionRef.id,
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  } as const);
}

function command(): ConnectorCommand {
  return Object.freeze({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workspaceId,
    projectId,
    actor: {
      kind: "HUMAN",
      principalId: actorId,
      issuer: "https://fake-idp/",
      subject: "requester.alpha",
    },
    commandType: "operational-work-item.request.create",
    capability: {
      key: "operational-work-item",
      exactContractVersion: "1.0.0",
      operation: "request.create",
      logicalRole: "QA_REQUEST_AUTHORITY",
    },
    target: {
      workspaceId,
      projectId,
      entityKind: "REQUEST",
      authorityScopeKey: "qa.alpha",
      naturalKey: "draft-1",
    },
    targetHash: digest("target"),
    payload: { summary: "Request" },
    payloadHash: digest("payload"),
    expectedExternalState: { mode: "MUST_NOT_EXIST" },
    bindingRef: ref("binding", 2),
    profileRef: ref("profile-0", 2),
    clientRequestKey: "client-key",
    effectIdempotencyKey: "awp:effect:command",
    dataClassificationKey: "INTERNAL",
    initialAuthorizationBasis: {
      kind: "PROJECT",
      policyVersion: "qa-local@1",
      membershipRef: ref("membership"),
      roleAssignmentRefs: [ref("role")],
      entitlementRefs: [ref("entitlement")],
      skillContext: "NOT_APPLICABLE",
    },
    initialAuthorizationBasisHash: digest("initial-basis"),
    correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    causationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    source: { intakeDraftId: "draft-1" },
    status: "QUEUED",
    effectAuthorizationStatus: "NOT_REQUIRED",
    outboxStatus: "ENQUEUED",
    attemptCount: 0,
    createdAt: at,
    updatedAt: at,
    rowVersion: 3,
  } as const);
}

function source(
  input: Readonly<{ revokedMembership?: boolean; mismatchedPins?: boolean }> = {},
): DataSource {
  const pins = resolved().pinSet.entries;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM project_onboarding_headers"))
      return [{ current_version: 3, current_operational_state: "ACTIVE" }];
    if (sql.includes("FROM projects p JOIN classification_catalog"))
      return [
        {
          id: projectId,
          workspace_id: workspaceId,
          key: "ALPHA",
          state: "ACTIVE",
          classification_key: "INTERNAL",
          rank: 10,
        },
      ];
    if (sql.includes("FROM workspace_memberships"))
      return [
        {
          id: "membership",
          workspace_id: workspaceId,
          principal_id: actorId,
          state: "ACTIVE",
          valid_from: new Date("2026-01-01T00:00:00.000Z"),
          valid_until: null,
          revoked_at: input.revokedMembership ? new Date("2026-08-31T11:59:00.000Z") : null,
          row_version: 1,
        },
      ];
    if (sql.includes("FROM role_assignments"))
      return [
        {
          id: "role",
          workspace_id: workspaceId,
          project_id: projectId,
          principal_id: actorId,
          role_key: "requester",
          effect: "ALLOW",
          permissions: ["qa.request.confirm"],
          valid_from: new Date("2026-01-01T00:00:00.000Z"),
          valid_until: null,
          revoked_at: null,
          row_version: 1,
        },
      ];
    if (sql.includes("FROM project_entitlements"))
      return [
        {
          id: "entitlement",
          workspace_id: workspaceId,
          project_id: projectId,
          principal_id: actorId,
          effect: "ALLOW",
          permissions: ["qa.request.confirm"],
          classification_ceiling_key: "INTERNAL",
          rank: 10,
          valid_from: new Date("2026-01-01T00:00:00.000Z"),
          valid_until: null,
          revoked_at: null,
          row_version: 1,
        },
      ];
    if (sql.includes("FROM connector_command_configuration_pins"))
      return pins.map((entry) => ({
        sequence: entry.sequence,
        purpose: entry.purpose,
        logical_role: entry.logicalRole,
        project_integration_binding_ref: entry.bindingRef,
        connector_profile_ref: entry.profileRef,
        mapping_ref: entry.mappingRef,
        connection_ref: entry.connectionRef,
        content_hash:
          input.mismatchedPins && entry.sequence === 1 ? digest("tampered") : entry.contentHash,
        adapter_family: entry.adapterFamily,
        adapter_contract_version: entry.adapterContractVersion,
        authority_namespace_hash: entry.authorityNamespaceHash,
      }));
    throw new Error(`UNEXPECTED_SQL:${sql}`);
  });
  return { query } as unknown as DataSource;
}

describe("qa-jira request-create effect-time gate", () => {
  it("re-authorizes the human and exact persisted ordered pin set", async () => {
    const decision = await revalidateQaJiraRequestCreateEffect(source(), command(), resolved(), at);
    expect(decision.authorizationBasis).toEqual({
      kind: "PROJECT",
      policyVersion: "qa-jira-request-create@1",
      membershipRef: ref("membership"),
      roleAssignmentRefs: [ref("role")],
      entitlementRefs: [ref("entitlement")],
      skillContext: "NOT_APPLICABLE",
    });
    expect(decision.authorizationBasisHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails before Jira invocation after membership revocation or any pin drift", async () => {
    const jiraTransport = vi.fn();
    await expect(
      revalidateQaJiraRequestCreateEffect(
        source({ revokedMembership: true }),
        command(),
        resolved(),
        at,
      ),
    ).rejects.toThrow("REQUEST_CREATE_UNAUTHORIZED");
    await expect(
      revalidateQaJiraRequestCreateEffect(
        source({ mismatchedPins: true }),
        command(),
        resolved(),
        at,
      ),
    ).rejects.toThrow("JIRA_EFFECT_PIN_SET_DRIFT");
    expect(jiraTransport).not.toHaveBeenCalled();
  });
});
