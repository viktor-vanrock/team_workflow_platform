import { createHash } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  onQaRequestConfirmed,
  type QaConfirmedDraft,
  type QaIntakePayload,
  type QaOperationalRequestCreateResult,
  type QaResponseChannelResolver,
  QaProjectPolicyRepository,
  QaTypeOrmIntakeConfirmationWriter,
  type QaWorkspaceContext,
  validateConfirmedQaIntake,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type CommandConfigurationPin,
  type CompleteOperationalObservation,
  ConfigurationPinSet,
  type ConnectorCommand,
  deriveOperationalCreateCommandIdentity,
  type OperationalCreateIdentity,
} from "@awp/platform-core";
import { TypeOrmOperationalAuthorityRepository } from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { qaLocalFixtureCatalog } from "../seed/qa-local-seed.ts";
import { resolveLocalQaProjectConfiguration } from "./qa-local-project-configuration.ts";
import {
  connectorKey,
  jiraConnectionRuntimeContent,
  jiraMappingRuntimeContent,
} from "./qa-connection-content.ts";

export { jiraConnectionRuntimeContent } from "./qa-connection-content.ts";

type Row = Readonly<Record<string, unknown>>;
type VersionedRef = Readonly<{ id: string; version: number }>;

export function assertQaJiraConfiguredEndpoint(
  environment: RuntimeEnvironment,
  scope: Readonly<{ workspaceId: string; projectId: string }>,
  configuredEndpoint: string,
): void {
  if (environment.profile === "local" || environment.profile === "test") {
    if (
      !environment.mockHubUrl ||
      new URL(configuredEndpoint).origin !== new URL(environment.mockHubUrl).origin
    )
      throw new Error("JIRA_LOCAL_EXACT_ENDPOINT_MISMATCH");
    return;
  }
  const deployment = environment.deployment;
  const jiraEndpoint = deployment?.endpoints.find((endpoint) => endpoint.purpose === "jira");
  if (
    !deployment ||
    deployment.workspaceId !== scope.workspaceId ||
    !deployment.projectIds.includes(scope.projectId) ||
    !jiraEndpoint ||
    configuredEndpoint !== jiraEndpoint.url
  )
    throw new Error("JIRA_CORPORATE_EXACT_ENDPOINT_MISMATCH");
}

export interface QaJiraResolvedPins {
  readonly pinSet: ConfigurationPinSet;
  readonly entries: readonly QaJiraResolvedPinEntry[];
  readonly bindingRef: VersionedRef;
  readonly bindingContent: Readonly<Record<string, unknown>>;
  readonly profileRef: VersionedRef;
  readonly profileContent: Readonly<Record<string, unknown>>;
  readonly mappingRef: VersionedRef;
  readonly mappingContent: Readonly<Record<string, unknown>>;
  readonly connectionRef: VersionedRef;
  readonly connectionContent: Readonly<Record<string, unknown>>;
  readonly connectionHeaderId: string;
  readonly adapterFamily: "jira-cloud-v3";
  readonly adapterContractVersion: "1.0.0";
}

export interface QaJiraResolvedPinEntry {
  readonly pin: CommandConfigurationPin;
  readonly profileContent: Readonly<Record<string, unknown>>;
  readonly mappingContent: Readonly<Record<string, unknown>>;
  readonly connectionContent: Readonly<Record<string, unknown>>;
}

export interface QaJiraRequestCreateCommandIdentity {
  readonly operationalIdentity: OperationalCreateIdentity;
  readonly commandId: string;
  readonly effectIdempotencyKey: string;
}

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

/** Domain create identity is independent from the transport-level HTTP idempotency key. */
export function deriveQaJiraRequestCreateCommandIdentity(
  input: Readonly<{
    sourceId: string;
    confirmationVersion: number;
    pins: ConfigurationPinSet;
  }>,
): QaJiraRequestCreateCommandIdentity {
  const identity = deriveOperationalCreateCommandIdentity({
    sourceId: input.sourceId,
    sourceVersion: input.confirmationVersion,
    operation: "request.create",
    pins: input.pins,
    commandNamespace: "qa-jira-request-create",
  });
  return Object.freeze(identity);
}

function versionedRef(value: unknown, code: string): VersionedRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !Number.isInteger(Number(record.version)) ||
    Number(record.version) < 1
  )
    throw new Error(code);
  return Object.freeze({ id: record.id, version: Number(record.version) });
}

function sameVersionedRef(value: unknown, expected: VersionedRef): boolean {
  try {
    const actual = versionedRef(json<unknown>(value), "JIRA_STORED_PIN_REF_INVALID");
    return actual.id === expected.id && actual.version === expected.version;
  } catch {
    return false;
  }
}

function assertEmbeddedContentHash(value: unknown, expected: string, code: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const embedded = (value as Record<string, unknown>).contentHash;
  if (embedded !== undefined && embedded !== expected) throw new Error(code);
}

function storedPinMatches(
  row: Row | undefined,
  pin: CommandConfigurationPin,
  requirementKey: string,
): boolean {
  return (
    row !== undefined &&
    Number(row.sequence) === pin.sequence &&
    row.purpose === pin.purpose &&
    row.requirement_key === requirementKey &&
    row.logical_role === pin.logicalRole &&
    sameVersionedRef(row.project_integration_binding_ref, pin.bindingRef) &&
    sameVersionedRef(row.connector_profile_ref, pin.profileRef) &&
    sameVersionedRef(row.mapping_ref, pin.mappingRef) &&
    sameVersionedRef(row.connection_ref, pin.connectionRef) &&
    row.content_hash === pin.contentHash &&
    row.adapter_family === pin.adapterFamily &&
    row.adapter_contract_version === pin.adapterContractVersion &&
    row.authority_namespace_hash === pin.authorityNamespaceHash
  );
}

async function publishedRevision(
  manager: EntityManager,
  table: string,
  scope: Readonly<{ workspaceId: string; projectId?: string }>,
  ref: VersionedRef,
): Promise<Readonly<{ content: Record<string, unknown>; contentHash: string }>> {
  if (
    !new Set([
      "project_integration_binding_revisions",
      "connector_profile_revisions",
      "connector_mapping_revisions",
      "connection_revisions",
    ]).has(table)
  )
    throw new Error("JIRA_PIN_REVISION_TABLE_FORBIDDEN");
  const projectClause =
    table === "project_integration_binding_revisions" ? " AND project_id=$4" : "";
  const rows = (await manager.query(
    `SELECT content,content_hash FROM ${table} WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'${projectClause}`,
    projectClause
      ? [scope.workspaceId, ref.id, ref.version, scope.projectId]
      : [scope.workspaceId, ref.id, ref.version],
  )) as readonly Row[];
  const row = rows[0];
  if (!row) throw new Error("JIRA_EXACT_CONFIGURATION_REVISION_NOT_FOUND");
  return Object.freeze({
    content: json<Record<string, unknown>>(row.content),
    contentHash: String(row.content_hash),
  });
}

async function assertValidationEvidence(
  manager: EntityManager,
  scope: Readonly<{ workspaceId: string; projectId: string }>,
  kind: "BINDING" | "PROFILE" | "MAPPING" | "CONNECTION",
  ref: VersionedRef,
  expectedContentHash: string,
): Promise<void> {
  const rows = (await manager.query(
    "SELECT outcome,content_hash FROM integration_validation_reports WHERE workspace_id=$1 AND subject_kind=$2 AND subject_id=$3 AND subject_version=$4 AND (project_id IS NULL OR project_id=$5) ORDER BY created_at DESC LIMIT 1",
    [scope.workspaceId, kind, ref.id, ref.version, scope.projectId],
  )) as readonly Row[];
  const report = rows[0];
  if (report?.outcome !== "VALID") throw new Error(`JIRA_${kind}_VALIDATION_EVIDENCE_REQUIRED`);
  if (String(report.content_hash) !== expectedContentHash)
    throw new Error(`JIRA_${kind}_VALIDATION_EVIDENCE_STALE`);
}

async function loadQaJiraRequestCreateConfiguration(
  manager: EntityManager,
  scope: Readonly<{ workspaceId: string; projectId: string }>,
  bindingRef: VersionedRef,
  expectedPrimaryProfileRef: VersionedRef,
  environment: RuntimeEnvironment,
): Promise<QaJiraResolvedPins> {
  const binding = await publishedRevision(
    manager,
    "project_integration_binding_revisions",
    scope,
    bindingRef,
  );
  await assertValidationEvidence(manager, scope, "BINDING", bindingRef, binding.contentHash);
  const configuredEntries = Array.isArray(binding.content.entries)
    ? binding.content.entries.map((entry) => json<Record<string, unknown>>(entry))
    : [];
  const primary = configuredEntries.filter((entry) => entry.logicalRole === "QA_REQUEST_AUTHORITY");
  const auxiliary = configuredEntries.filter((entry) => entry.logicalRole === "SOURCE_CONTEXT");
  if (primary.length !== 1 || auxiliary.length !== 1)
    throw new Error("JIRA_REQUEST_CREATE_PIN_CHAIN_INCOMPLETE");

  const entries: QaJiraResolvedPinEntry[] = [];
  for (const [sequence, purpose, logicalRole, entry] of [
    [0, "PRIMARY", "QA_REQUEST_AUTHORITY", primary[0]!],
    [1, "AUXILIARY", "SOURCE_CONTEXT", auxiliary[0]!],
  ] as const) {
    const profileRef = versionedRef(entry.profileRef, "JIRA_PIN_PROFILE_REF_INVALID");
    if (
      sequence === 0 &&
      (profileRef.id !== expectedPrimaryProfileRef.id ||
        profileRef.version !== expectedPrimaryProfileRef.version)
    ) {
      throw new Error("JIRA_COMMAND_PROFILE_PIN_MISMATCH");
    }
    const profile = await publishedRevision(
      manager,
      "connector_profile_revisions",
      scope,
      profileRef,
    );
    assertEmbeddedContentHash(
      entry.profileRef,
      profile.contentHash,
      "JIRA_PROFILE_REF_CONTENT_HASH_MISMATCH",
    );
    const mappingRef = versionedRef(profile.content.mappingRef, "JIRA_MAPPING_REF_INVALID");
    const connectionRef = versionedRef(
      profile.content.connectionRef,
      "JIRA_CONNECTION_REF_INVALID",
    );
    const mapping = await publishedRevision(
      manager,
      "connector_mapping_revisions",
      scope,
      mappingRef,
    );
    const connection = await publishedRevision(
      manager,
      "connection_revisions",
      scope,
      connectionRef,
    );
    assertEmbeddedContentHash(
      profile.content.mappingRef,
      mapping.contentHash,
      "JIRA_MAPPING_REF_CONTENT_HASH_MISMATCH",
    );
    assertEmbeddedContentHash(
      profile.content.connectionRef,
      connection.contentHash,
      "JIRA_CONNECTION_REF_CONTENT_HASH_MISMATCH",
    );
    if (
      connectorKey(profile.content) !== "jira.operational-authority" ||
      connectorKey(mapping.content) !== "jira.operational-authority" ||
      connectorKey(connection.content) !== "jira.operational-authority"
    )
      throw new Error("JIRA_EXACT_CONNECTOR_CHAIN_MISMATCH");
    await assertValidationEvidence(manager, scope, "PROFILE", profileRef, profile.contentHash);
    await assertValidationEvidence(manager, scope, "MAPPING", mappingRef, mapping.contentHash);
    await assertValidationEvidence(
      manager,
      scope,
      "CONNECTION",
      connectionRef,
      connection.contentHash,
    );

    const runtimeConnection = jiraConnectionRuntimeContent(connection.content);
    const configuredEndpoint = String(
      runtimeConnection.baseUrl ?? runtimeConnection.endpoint ?? "",
    );
    assertQaJiraConfiguredEndpoint(environment, scope, configuredEndpoint);
    const adapterFamily = String(runtimeConnection.adapterFamily ?? "");
    const adapterContractVersion = String(runtimeConnection.adapterContractVersion ?? "");
    if (adapterFamily !== "jira-cloud-v3" || adapterContractVersion !== "1.0.0") {
      throw new Error("JIRA_ADAPTER_PIN_UNSUPPORTED");
    }
    const authorityNamespaceHash = sha256({
      endpointOrigin: new URL(configuredEndpoint).origin,
      adapterFamily,
      projectId: String(runtimeConnection.projectId ?? ""),
    } as JsonValue);
    const pin: CommandConfigurationPin = Object.freeze({
      sequence,
      purpose,
      logicalRole,
      bindingRef,
      profileRef,
      mappingRef,
      connectionRef,
      contentHash: sha256({
        sequence,
        purpose,
        logicalRole,
        bindingRevisionContentHash: binding.contentHash,
        profileRevisionContentHash: profile.contentHash,
        mappingRevisionContentHash: mapping.contentHash,
        connectionRevisionContentHash: connection.contentHash,
        bindingEntry: entry,
      } as JsonValue),
      adapterFamily,
      adapterContractVersion,
      authorityNamespaceHash,
    });
    entries.push(
      Object.freeze({
        pin,
        profileContent: Object.freeze({ ...profile.content }),
        mappingContent: Object.freeze(jiraMappingRuntimeContent(mapping.content)),
        connectionContent: Object.freeze(runtimeConnection),
      }),
    );
  }
  const pinSet = ConfigurationPinSet.create(entries.map(({ pin }) => pin));
  const primaryEntry = entries[0]!;
  return Object.freeze({
    pinSet,
    entries: Object.freeze(entries),
    bindingRef,
    bindingContent: Object.freeze({ ...binding.content }),
    profileRef: primaryEntry.pin.profileRef,
    profileContent: primaryEntry.profileContent,
    mappingRef: primaryEntry.pin.mappingRef,
    mappingContent: primaryEntry.mappingContent,
    connectionRef: primaryEntry.pin.connectionRef,
    connectionContent: primaryEntry.connectionContent,
    connectionHeaderId: primaryEntry.pin.connectionRef.id,
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
  });
}

/** Read-only resolution used to derive the stable create identity at ingress. */
export async function resolveQaJiraRequestCreateConfiguration(
  source: DataSource,
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    bindingRef: VersionedRef;
    profileRef: VersionedRef;
    environment: RuntimeEnvironment;
  }>,
): Promise<QaJiraResolvedPins> {
  return await source.transaction(
    "REPEATABLE READ",
    async (manager) =>
      await loadQaJiraRequestCreateConfiguration(
        manager,
        input,
        input.bindingRef,
        input.profileRef,
        input.environment,
      ),
  );
}

/** Resolves and persists the exact primary + source-context chain before any effect starts. */
export async function resolveAndPinQaJiraCommand(
  source: DataSource,
  command: ConnectorCommand,
  environment: RuntimeEnvironment,
): Promise<QaJiraResolvedPins> {
  return await source.transaction("SERIALIZABLE", async (manager) => {
    const bindingRef = versionedRef(command.bindingRef, "JIRA_BINDING_REF_INVALID");
    const profileRef = versionedRef(command.profileRef, "JIRA_PROFILE_REF_INVALID");
    const resolved = await loadQaJiraRequestCreateConfiguration(
      manager,
      command,
      bindingRef,
      profileRef,
      environment,
    );
    const requirementKey =
      command.target && typeof command.target === "object" && "authorityScopeKey" in command.target
        ? String((command.target as Record<string, unknown>).authorityScopeKey)
        : "qa-request-authority";
    for (const { pin } of resolved.entries) {
      await manager.query(
        "INSERT INTO connector_command_configuration_pins(command_id,sequence,purpose,requirement_key,logical_role,project_integration_binding_ref,connector_profile_ref,mapping_ref,connection_ref,content_hash,adapter_family,adapter_contract_version,authority_namespace_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(command_id,sequence) DO NOTHING",
        [
          command.id,
          pin.sequence,
          pin.purpose,
          requirementKey,
          pin.logicalRole,
          JSON.stringify(pin.bindingRef),
          JSON.stringify(pin.profileRef),
          JSON.stringify(pin.mappingRef),
          JSON.stringify(pin.connectionRef),
          pin.contentHash,
          pin.adapterFamily,
          pin.adapterContractVersion,
          pin.authorityNamespaceHash,
        ],
      );
      const stored = (await manager.query(
        "SELECT sequence,purpose,requirement_key,logical_role,project_integration_binding_ref,connector_profile_ref,mapping_ref,connection_ref,content_hash,adapter_family,adapter_contract_version,authority_namespace_hash FROM connector_command_configuration_pins WHERE command_id=$1 AND sequence=$2",
        [command.id, pin.sequence],
      )) as readonly Row[];
      if (!storedPinMatches(stored[0], pin, requirementKey)) {
        throw new Error("JIRA_COMMAND_CONFIGURATION_PIN_CONFLICT");
      }
    }
    return resolved;
  });
}

function confirmedDraft(row: Row, command: ConnectorCommand): QaConfirmedDraft {
  if (!command.source.intakeDraftId) throw new Error("QA_JIRA_COMMAND_DRAFT_REQUIRED");
  if (
    !Number.isSafeInteger(command.source.confirmationVersion) ||
    command.source.confirmationVersion! < 1
  ) {
    throw new Error("QA_JIRA_COMMAND_CONFIRMATION_VERSION_REQUIRED");
  }
  const payload = json<QaIntakePayload>(row.intake_payload);
  const draft: QaConfirmedDraft = {
    id: command.source.intakeDraftId,
    version: command.source.confirmationVersion!,
    contentHash: sha256(payload as unknown as JsonValue),
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    definitionRef: { key: "qa.validation" as const, version: "1.0.0" as const },
    state: "CONFIRMED",
    requester: {
      kind: "HUMAN",
      principalId: String(row.created_by),
      issuer: String(row.issuer),
      subject: String(row.subject),
    },
    payload,
    authoritativeClassificationKey: payload.requestedClassificationKey,
  };
  return Object.freeze(draft);
}

async function persistDelta(
  manager: EntityManager,
  command: ConnectorCommand,
  context: QaWorkspaceContext,
  delta: Awaited<ReturnType<typeof onQaRequestConfirmed>>,
): Promise<void> {
  for (const event of delta.events ?? []) {
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp()) ON CONFLICT DO NOTHING",
      [
        deterministicUuid(`${event.eventType}:${event.entityId}`),
        command.workspaceId,
        command.projectId,
        event.eventType,
        JSON.stringify(event.payload),
        sha256(event.payload as JsonValue),
      ],
    );
  }
  for (const audit of delta.audit ?? []) {
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,$8,$9,$10,'INTERNAL',$11) ON CONFLICT DO NOTHING",
      [
        deterministicUuid(`${context.correlationId}:${audit.action}`),
        command.workspaceId,
        command.projectId,
        JSON.stringify(context.actor),
        audit.action,
        audit.outcome,
        audit.reasonCode,
        context.correlationId,
        context.causationId,
        JSON.stringify(context.authorizationBasis),
        JSON.stringify({ values: audit.attributes ?? {}, versionRefs: [] }),
      ],
    );
  }
}

/** Callback for TypeOrmCommandDeliveryStore.confirmWith; all writes share its transaction. */
export async function materializeQaJiraRequestConfirmation(
  source: DataSource,
  manager: EntityManager,
  command: ConnectorCommand,
  result: QaOperationalRequestCreateResult,
  pins: QaJiraResolvedPins,
  externalObservation?: CompleteOperationalObservation,
  corporateResponseChannels?: QaResponseChannelResolver,
): Promise<void> {
  if (!command.source.intakeDraftId || command.actor.kind !== "HUMAN")
    throw new Error("QA_JIRA_CONFIRMATION_SOURCE_INVALID");
  const rows = (await manager.query(
    "SELECT d.*,i.issuer,i.subject FROM intake_drafts d JOIN identities i ON i.id=d.created_by WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.id=$3",
    [command.workspaceId, command.projectId, command.source.intakeDraftId],
  )) as readonly Row[];
  const row = rows[0];
  if (!row || String(row.created_by) !== command.actor.principalId)
    throw new Error("QA_JIRA_CONFIRMATION_DRAFT_NOT_FOUND");
  const draft = confirmedDraft(row, command);
  const context: QaWorkspaceContext = Object.freeze({
    actor: draft.requester,
    scope: {
      kind: "PROJECT" as const,
      workspaceId: command.workspaceId,
      projectId: command.projectId,
    },
    correlationId: command.correlationId,
    causationId: command.causationId,
    authorizationBasis: command.initialAuthorizationBasis as NonNullable<
      QaWorkspaceContext["authorizationBasis"]
    >,
  });
  const selected = await resolveLocalQaProjectConfiguration(manager, command);
  if (
    selected.bindingRef.id !== command.bindingRef.id ||
    selected.bindingRef.version !== command.bindingRef.version ||
    selected.profileRef.id !== command.profileRef.id ||
    selected.profileRef.version !== command.profileRef.version
  )
    throw new Error("QA_PROJECT_JIRA_CONFIGURATION_STALE");
  const projectContext = await new QaProjectPolicyRepository(manager).currentProjectContext(
    { workspaceId: command.workspaceId, projectId: command.projectId },
    selected.projectContextId,
  );
  if (!projectContext) throw new Error("QA_PROJECT_CONTEXT_NOT_PUBLISHED");
  const validated = await validateConfirmedQaIntake({
    context,
    draft,
    projectContext,
    bindingRef: command.bindingRef,
    evaluatedAt: command.createdAt.toISOString(),
    responseChannels: corporateResponseChannels ?? {
      resolve: async ({ requester, evaluatedAt }) => {
        const fixture =
          qaLocalFixtureCatalog.responseChannels[
            draft.requester.subject as keyof typeof qaLocalFixtureCatalog.responseChannels
          ];
        const policy = {
          key: "qa.response-channel-resolution",
          version: "1.0.0",
          contentHash: sha256({ key: "qa.response-channel-resolution", version: "1.0.0" }),
        };
        return fixture?.state === "CONFIRMED"
          ? {
              state: "CONFIRMED",
              requesterPrincipal: requester,
              resolutionPolicyRef: policy,
              responseChannelRef: {
                channelKind: "PLATFORM_WEB",
                channelId: fixture.channelId,
                version: fixture.version,
                contentHash: sha256(fixture as unknown as JsonValue),
              },
              evaluatedAt,
            }
          : {
              state: "MISSING",
              requesterPrincipal: requester,
              resolutionPolicyRef: policy,
              evaluatedAt,
              missingReasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
            };
      },
    },
  });

  await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `qa-jira-confirm:${command.id}`,
  ]);
  const workItemId = deterministicUuid(`${command.id}:work-item`);
  const operationalBindingId = deterministicUuid(`${command.id}:operational-binding`);
  await manager.query(
    "UPDATE intake_drafts SET state='SUBMITTED',submitted_at=COALESCE(submitted_at,clock_timestamp()),row_version=CASE WHEN state='DRAFT' THEN row_version+1 ELSE row_version END WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
    [command.workspaceId, command.projectId, draft.id],
  );
  await manager.query(
    "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,source_draft_id,created_by,state,classification_key,row_version,created_at,acceptance_source,title,normalized_status,requester_principal_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,'NEW',$7,1,clock_timestamp(),'PLATFORM_DRAFT',$8,'NEW',$6,clock_timestamp()) ON CONFLICT(workspace_id,project_id,id) DO NOTHING",
    [
      workItemId,
      command.workspaceId,
      command.projectId,
      row.work_type_definition_id,
      draft.id,
      command.actor.principalId,
      draft.payload.requestedClassificationKey,
      draft.payload.title,
    ],
  );
  await manager.query(
    "INSERT INTO operational_bindings(id,workspace_id,project_id,work_item_id,project_integration_binding_ref,connector_profile_ref,connection_header_id,connection_ref,mapping_ref,adapter_family,adapter_contract_version,external_entity_type,external_entity_id,initial_external_display_key,current_external_display_key,acceptance_source,current_projection_revision_id,current_external_revision_token,sync_state,freshness_state,fresh_until,last_observed_at,created_at,created_by,updated_at,row_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'REQUEST',$12,$13,$13,'CREATE_READ_BACK',NULL,NULL,'SYNCED','CURRENT',$14,$15,clock_timestamp(),$16,clock_timestamp(),1) ON CONFLICT(workspace_id,project_id,work_item_id) DO NOTHING",
    [
      operationalBindingId,
      command.workspaceId,
      command.projectId,
      workItemId,
      JSON.stringify(pins.bindingRef),
      JSON.stringify(pins.profileRef),
      pins.connectionHeaderId,
      JSON.stringify(pins.connectionRef),
      JSON.stringify(pins.mappingRef),
      pins.adapterFamily,
      pins.adapterContractVersion,
      result.externalEntityId,
      result.externalDisplayKey,
      new Date(Date.parse(result.observedAt) + 120_000),
      result.observedAt,
      command.actor.principalId,
    ],
  );
  const observation: CompleteOperationalObservation =
    externalObservation ??
    Object.freeze({
      observationId: deterministicUuid(`${command.id}:create-read-back`),
      source: "CREATE_READ_BACK",
      externalEntityId: result.externalEntityId,
      externalDisplayKey: result.externalDisplayKey,
      externalRevisionToken: result.externalVersion,
      authorityFieldsHash: sha256(result as unknown as JsonValue),
      providerUpdatedAt: result.observedAt,
      observedAt: result.observedAt,
      rawStatus: { id: "1", name: result.rawExternalState },
      normalizedStatus: result.normalizedStatus,
      requester: {
        externalPrincipalId: `local:${command.actor.principalId}`,
        canonicalPrincipalId: command.actor.principalId,
      },
      assignee: null,
      priority: null,
      dueDate: null,
      profileRef: pins.profileRef,
      mappingRef: pins.mappingRef,
      connectionRef: pins.connectionRef,
      adapterFamily: pins.adapterFamily,
      adapterContractVersion: pins.adapterContractVersion,
    });
  if (
    externalObservation &&
    (externalObservation.source !== "CREATE_READ_BACK" ||
      externalObservation.externalEntityId !== result.externalEntityId ||
      externalObservation.normalizedStatus !== "NEW" ||
      externalObservation.profileRef.id !== pins.profileRef.id ||
      externalObservation.profileRef.version !== pins.profileRef.version ||
      externalObservation.mappingRef.id !== pins.mappingRef.id ||
      externalObservation.mappingRef.version !== pins.mappingRef.version ||
      externalObservation.connectionRef.id !== pins.connectionRef.id ||
      externalObservation.connectionRef.version !== pins.connectionRef.version)
  )
    throw new Error("QA_JIRA_CONFIRMATION_OBSERVATION_MISMATCH");
  await new TypeOrmOperationalAuthorityRepository(source).reduceObservation(
    manager,
    {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      bindingId: operationalBindingId,
    },
    observation,
    sha256(observation as unknown as JsonValue),
    command.correlationId,
    command.causationId,
  );
  await manager.query(
    "UPDATE work_items SET operational_binding_id=$4,title=$5,normalized_status='NEW',requester_principal_id=$6,updated_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
    [
      command.workspaceId,
      command.projectId,
      workItemId,
      operationalBindingId,
      draft.payload.title,
      command.actor.principalId,
    ],
  );
  const delta = await onQaRequestConfirmed({
    effect: {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      commandId: command.id,
      effectIdempotencyKey: command.effectIdempotencyKey,
      capabilityKey: command.capability.key,
      capabilityVersion: command.capability.exactContractVersion,
      operation: command.capability.operation,
      result,
      source: command.source,
      bindingRef: command.bindingRef,
      profileRefs: [command.profileRef],
      correlationId: command.correlationId,
      causationId: command.causationId,
      workItemId,
    },
    transaction: {
      transactionId: `worker:${command.id}`,
      native: manager,
      contributionKey: "qa.request-create.confirmation",
      idempotencyKey: `${command.id}:confirmation:qa.request-create.confirmation`,
    },
    materials: {
      load: async () => ({
        context,
        draft,
        projectContext,
        responseChannelResolution: validated.responseChannelResolution,
        semanticInput: validated.semanticInput,
        blockersDeclared: validated.blockersDeclared,
        dependenciesDeclared: validated.dependenciesDeclared,
      }),
    },
    writer: new QaTypeOrmIntakeConfirmationWriter(),
    ids: {
      extensionId: () => deterministicUuid(`${command.id}:qa-extension`),
      inputRevisionId: () => deterministicUuid(`${command.id}:qa-input:1`),
      eventId: () => deterministicUuid(`${command.id}:qa-accepted-event`),
    },
    recordedAt: command.createdAt.toISOString(),
  });
  await persistDelta(manager, command, context, delta);
}
