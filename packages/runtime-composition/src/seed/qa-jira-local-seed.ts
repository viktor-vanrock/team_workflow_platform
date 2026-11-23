import { createHash } from "node:crypto";

import type { DataSource, QueryRunner } from "typeorm";

import { jiraConnectorManifest } from "@awp/connector-jira";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { localPersonaIds, localSeedIds } from "./local-seed.ts";
import { qaLocalSeedIds, type QaLocalSeedResult, runQaLocalSeed } from "./qa-local-seed.ts";

export const QA_JIRA_LOCAL_SEED_KEY = "003-qa-jira-local";
export const QA_JIRA_LOCAL_SEED_VERSION = 5;

const QA_JIRA_LOCAL_BASE_SEED_VERSION = 3;
const QA_JIRA_LOCAL_SOURCE_SEED_VERSION = 4;

export const qaJiraLocalSeedIds = Object.freeze({
  connector: "91300000-0000-4000-8000-000000000001",
  connectionRevision: "92300000-0000-4000-8000-000000000001",
  mappingRevision: "92300000-0000-4000-8000-000000000002",
  profileRevision: "92300000-0000-4000-8000-000000000003",
  alphaBindingRevision: "92300000-0000-4000-8000-000000000004",
  connectionValidation: "92400000-0000-4000-8000-000000000001",
  mappingValidation: "92400000-0000-4000-8000-000000000002",
  profileValidation: "92400000-0000-4000-8000-000000000003",
  alphaBindingValidation: "92400000-0000-4000-8000-000000000004",
  sourceMapping: "92500000-0000-4000-8000-000000000001",
  sourceProfile: "92500000-0000-4000-8000-000000000002",
  profileSourcePolicyRevision: "92600000-0000-4000-8000-000000000001",
  sourceMappingRevision: "92600000-0000-4000-8000-000000000002",
  sourceProfileRevision: "92600000-0000-4000-8000-000000000003",
  alphaBindingSourceRevision: "92600000-0000-4000-8000-000000000004",
  profileSourcePolicyValidation: "92700000-0000-4000-8000-000000000001",
  sourceMappingValidation: "92700000-0000-4000-8000-000000000002",
  sourceProfileValidation: "92700000-0000-4000-8000-000000000003",
  alphaBindingSourceValidation: "92700000-0000-4000-8000-000000000004",
  requesterExternalPrincipalBinding: "92800000-0000-4000-8000-000000000001",
});

/** Base Jira successors published by seed v3 and retained for recovery. */
export const qaJiraLocalBaseSeedRefs = Object.freeze({
  connection: Object.freeze({ id: qaLocalSeedIds.connection, version: 2 }),
  mapping: Object.freeze({ id: qaLocalSeedIds.mapping, version: 2 }),
  profile: Object.freeze({ id: qaLocalSeedIds.profile, version: 5 }),
  binding: Object.freeze({ id: qaLocalSeedIds.alphaBinding, version: 5 }),
});

/** Exact immutable revisions selected by new qa-jira-local commands. */
export const qaJiraLocalSeedRefs = Object.freeze({
  connection: qaJiraLocalBaseSeedRefs.connection,
  mapping: qaJiraLocalBaseSeedRefs.mapping,
  profile: Object.freeze({ id: qaLocalSeedIds.profile, version: 6 }),
  sourceMapping: Object.freeze({ id: qaJiraLocalSeedIds.sourceMapping, version: 1 }),
  sourceProfile: Object.freeze({ id: qaJiraLocalSeedIds.sourceProfile, version: 1 }),
  binding: Object.freeze({ id: qaLocalSeedIds.alphaBinding, version: 6 }),
});

type JsonRecord = Readonly<Record<string, unknown>>;
type PublishedRevision = Readonly<{
  revisionId: string;
  version: number;
  contentHash: string;
}>;
type PublishedContentRevision = PublishedRevision & Readonly<{ content: JsonRecord }>;

export interface QaJiraLocalPublishedChain {
  readonly connection: PublishedRevision;
  readonly mapping: PublishedRevision;
  readonly profile: PublishedContentRevision;
  readonly binding: PublishedContentRevision;
}

interface PlannedRevision {
  readonly revisionId: string;
  readonly headerId: string;
  readonly version: number;
  readonly content: JsonRecord;
  readonly contentHash: `sha256:${string}`;
}

export interface QaJiraLocalRevisionPlan {
  readonly refs: typeof qaJiraLocalBaseSeedRefs;
  readonly connection: PlannedRevision;
  readonly mapping: PlannedRevision;
  readonly profile: PlannedRevision;
  readonly binding: PlannedRevision;
}

export interface QaJiraLocalSourceRevisionPlan {
  readonly refs: typeof qaJiraLocalSeedRefs;
  readonly profile: PlannedRevision;
  readonly sourceMapping: PlannedRevision;
  readonly sourceProfile: PlannedRevision;
  readonly binding: PlannedRevision;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function assertExpectedQaLocalPredecessors(published: QaJiraLocalPublishedChain): void {
  if (published.connection.version !== 1)
    throw new Error("QA_JIRA_CONNECTION_PREDECESSOR_UNEXPECTED");
  if (published.mapping.version !== 1) throw new Error("QA_JIRA_MAPPING_PREDECESSOR_UNEXPECTED");
  if (published.profile.version !== 4) throw new Error("QA_JIRA_PROFILE_PREDECESSOR_UNEXPECTED");
  if (published.binding.version !== 4) throw new Error("QA_JIRA_BINDING_PREDECESSOR_UNEXPECTED");
}

/**
 * Builds only successor content. The published qa-local inputs are never edited;
 * their exact row ids and hashes become immutable lineage references.
 */
export function buildQaJiraLocalRevisionPlan(
  published: QaJiraLocalPublishedChain,
  mockHubUrl: string,
): QaJiraLocalRevisionPlan {
  assertExpectedQaLocalPredecessors(published);
  const connectorKey = jiraConnectorManifest.metadata.key;
  const connection = Object.freeze({
    connectorKey,
    endpoint: mockHubUrl,
    environmentScope: "LOCAL",
    serviceIdentitySecretRef: "secretref://local/jira/service",
    adapterFamily: "jira-cloud-v3",
    adapterContractVersion: "1.0.0",
    projectId: "100",
    issueTypeId: "10001",
    markerFieldId: "customfield_10011",
    previousRef: Object.freeze({
      id: published.connection.revisionId,
      version: published.connection.version,
      contentHash: published.connection.contentHash,
    }),
  });
  const connectionHash = digest(connection);
  const mapping = Object.freeze({
    capabilityKey: "operational-work-item",
    connectorKey,
    authorityScopeKey: "qa.alpha",
    projectDiscriminator: "ALPHA",
    outputFieldAllowlist: Object.freeze([
      "summary",
      "description",
      "customfield_10010",
      "customfield_10012",
    ]),
    requestCreateFieldIds: Object.freeze({
      summary: "summary",
      description: "description",
      projectDiscriminator: "customfield_10010",
      acceptanceOutcome: "customfield_10012",
    }),
    fields: Object.freeze({
      summary: "payload.summary",
      description: "payload.description",
      classification: "payload.dataClassificationKey",
      effectMarker: "context.effectIdempotencyKey",
    }),
    previousRef: Object.freeze({
      id: published.mapping.revisionId,
      version: published.mapping.version,
      contentHash: published.mapping.contentHash,
    }),
  });
  const mappingHash = digest(mapping);

  const currentProfile = published.profile.content;
  if (!Array.isArray(currentProfile.capabilityConfigurations)) {
    throw new Error("QA_JIRA_PROFILE_CAPABILITIES_REQUIRED");
  }
  const capabilityConfigurations = currentProfile.capabilityConfigurations.map((configuration) => {
    const value = json<Record<string, unknown>>(configuration);
    return Object.freeze({
      ...value,
      operations: Array.isArray(value.operations)
        ? value.operations.map((operation) =>
            Object.freeze({
              ...json<Record<string, unknown>>(operation),
              idempotencyStrategy: "RECONCILIATION",
              confirmationMode: "READ_BACK",
            }),
          )
        : value.operations,
    });
  });
  const profile = Object.freeze({
    ...currentProfile,
    connectorKey,
    connectionRef: Object.freeze({
      ...qaJiraLocalBaseSeedRefs.connection,
      contentHash: connectionHash,
    }),
    mappingRef: Object.freeze({ ...qaJiraLocalBaseSeedRefs.mapping, contentHash: mappingHash }),
    project: Object.freeze({ id: "100", name: "Central QA" }),
    issueType: Object.freeze({ id: "10001", name: "QA Request" }),
    projectDiscriminatorFieldId: "customfield_10010",
    effectMarkerFieldId: "customfield_10011",
    capabilityConfigurations: Object.freeze(capabilityConfigurations),
    previousRef: Object.freeze({
      id: published.profile.revisionId,
      version: published.profile.version,
      contentHash: published.profile.contentHash,
    }),
  });
  const profileHash = digest(profile);

  const currentBinding = published.binding.content;
  if (!Array.isArray(currentBinding.entries)) throw new Error("QA_JIRA_BINDING_ENTRIES_REQUIRED");
  const existingEntries = currentBinding.entries
    .map((entry) => json<Record<string, unknown>>(entry))
    .filter((entry) => entry.logicalRole !== "SOURCE_CONTEXT")
    .map((entry): JsonRecord =>
      Object.freeze({
        ...entry,
        profileRef: Object.freeze({ ...qaJiraLocalBaseSeedRefs.profile, contentHash: profileHash }),
      }),
    );
  const primary = existingEntries.find((entry) => entry.logicalRole === "QA_REQUEST_AUTHORITY");
  if (!primary) throw new Error("QA_JIRA_REQUEST_AUTHORITY_BINDING_REQUIRED");
  const binding = Object.freeze({
    ...currentBinding,
    entries: Object.freeze([
      ...existingEntries,
      Object.freeze({
        ...primary,
        logicalRole: "SOURCE_CONTEXT",
        operations: Object.freeze(["request.create"]),
      }),
    ]),
    previousRef: Object.freeze({
      id: published.binding.revisionId,
      version: published.binding.version,
      contentHash: published.binding.contentHash,
    }),
  });

  return Object.freeze({
    refs: qaJiraLocalBaseSeedRefs,
    connection: Object.freeze({
      revisionId: qaJiraLocalSeedIds.connectionRevision,
      headerId: qaJiraLocalBaseSeedRefs.connection.id,
      version: qaJiraLocalBaseSeedRefs.connection.version,
      content: connection,
      contentHash: connectionHash,
    }),
    mapping: Object.freeze({
      revisionId: qaJiraLocalSeedIds.mappingRevision,
      headerId: qaJiraLocalBaseSeedRefs.mapping.id,
      version: qaJiraLocalBaseSeedRefs.mapping.version,
      content: mapping,
      contentHash: mappingHash,
    }),
    profile: Object.freeze({
      revisionId: qaJiraLocalSeedIds.profileRevision,
      headerId: qaJiraLocalBaseSeedRefs.profile.id,
      version: qaJiraLocalBaseSeedRefs.profile.version,
      content: profile,
      contentHash: profileHash,
    }),
    binding: Object.freeze({
      revisionId: qaJiraLocalSeedIds.alphaBindingRevision,
      headerId: qaJiraLocalBaseSeedRefs.binding.id,
      version: qaJiraLocalBaseSeedRefs.binding.version,
      content: binding,
      contentHash: digest(binding),
    }),
  });
}

function assertExpectedQaJiraBasePredecessors(published: QaJiraLocalPublishedChain): void {
  if (published.connection.version !== qaJiraLocalBaseSeedRefs.connection.version) {
    throw new Error("QA_JIRA_SOURCE_CONNECTION_PREDECESSOR_UNEXPECTED");
  }
  if (published.mapping.version !== qaJiraLocalBaseSeedRefs.mapping.version) {
    throw new Error("QA_JIRA_SOURCE_MAPPING_PREDECESSOR_UNEXPECTED");
  }
  if (published.profile.version !== qaJiraLocalBaseSeedRefs.profile.version) {
    throw new Error("QA_JIRA_SOURCE_PROFILE_PREDECESSOR_UNEXPECTED");
  }
  if (published.binding.version !== qaJiraLocalBaseSeedRefs.binding.version) {
    throw new Error("QA_JIRA_SOURCE_BINDING_PREDECESSOR_UNEXPECTED");
  }
}

/**
 * Builds the append-only v4 source-context chain. New source Mapping/Profile
 * headers start at v1; only the primary Profile and project Binding advance.
 */
export function buildQaJiraLocalSourceRevisionPlan(
  published: QaJiraLocalPublishedChain,
): QaJiraLocalSourceRevisionPlan {
  assertExpectedQaJiraBasePredecessors(published);
  const connectorKey = jiraConnectorManifest.metadata.key;
  const sourceLinkPolicy = Object.freeze({
    strategy: "NATIVE_SAME_AUTHORITY",
    typeId: "10000",
    direction: "OUTWARD",
  });
  const profile = Object.freeze({
    ...published.profile.content,
    sourceLinkPolicy,
    previousRef: Object.freeze({
      id: published.profile.revisionId,
      version: published.profile.version,
      contentHash: published.profile.contentHash,
    }),
  });
  const profileHash = digest(profile);

  const sourceMapping = Object.freeze({
    key: "qa-jira-source-context",
    connectorKey,
    connectorRef: Object.freeze({
      key: connectorKey,
      version: jiraConnectorManifest.metadata.version,
    }),
    capabilityKey: "operational-work-item",
    logicalRole: "SOURCE_CONTEXT",
    dataClassificationKey: "INTERNAL",
    sourceReferenceMapping: Object.freeze({
      rules: Object.freeze([
        Object.freeze({
          sourceKind: "JIRA_ISSUE",
          subEffectKind: "LINK",
          identityField: "id",
          sameAuthorityRequired: true,
        }),
        Object.freeze({
          sourceKind: "URL",
          subEffectKind: "REMOTE_LINK",
          identityField: "id",
          publishedHttpsRequired: true,
        }),
      ]),
      commentPolicy: Object.freeze({ mode: "DISABLED" }),
      exactRefFields: Object.freeze(["kind", "id", "version", "contentHash"]),
    }),
  });
  const sourceMappingHash = digest(sourceMapping);

  const sourceProfile = Object.freeze({
    key: "qa-jira-source-context",
    connectorKey,
    connectorRef: Object.freeze({
      key: connectorKey,
      version: jiraConnectorManifest.metadata.version,
    }),
    connectionRef: Object.freeze({
      ...qaJiraLocalSeedRefs.connection,
      contentHash: published.connection.contentHash,
    }),
    mappingRef: Object.freeze({
      ...qaJiraLocalSeedRefs.sourceMapping,
      contentHash: sourceMappingHash,
    }),
    dataClassificationKey: "INTERNAL",
    capabilityConfigurations: Object.freeze([]),
    logicalRole: "SOURCE_CONTEXT",
    allowedProjectIds: Object.freeze(["200"]),
    allowedIssueTypeIds: Object.freeze(["10002"]),
    readJqlScope: Object.freeze({
      templateKey: "qa.alpha.source-context",
      contentHash: digest({ jql: "project = 200 AND issuetype = 10002" }),
    }),
    jiraLinkTypes: Object.freeze([
      Object.freeze({ typeId: sourceLinkPolicy.typeId, direction: sourceLinkPolicy.direction }),
    ]),
    remoteLinkGlobalIdPrefixes: Object.freeze(["awp:source:"]),
    allowedFields: Object.freeze(["summary", "status", "updated"]),
    rateBudgetRef: Object.freeze({
      id: "urn:awp:rate-budget:jira:source-context:local",
      version: 1,
      contentHash: digest({ windowSeconds: 60, maxRequests: 120, burst: 10, maxInFlight: 4 }),
    }),
  });
  const sourceProfileHash = digest(sourceProfile);

  const currentBinding = published.binding.content;
  if (!Array.isArray(currentBinding.entries))
    throw new Error("QA_JIRA_SOURCE_BINDING_ENTRIES_REQUIRED");
  let primaryCount = 0;
  let sourceCount = 0;
  const entries = currentBinding.entries.map((candidate): JsonRecord => {
    const entry = json<Record<string, unknown>>(candidate);
    if (entry.logicalRole === "QA_REQUEST_AUTHORITY") {
      primaryCount += 1;
      return Object.freeze({
        ...entry,
        profileRef: Object.freeze({ ...qaJiraLocalSeedRefs.profile, contentHash: profileHash }),
      });
    }
    if (entry.logicalRole === "SOURCE_CONTEXT") {
      sourceCount += 1;
      return Object.freeze({
        ...entry,
        profileRef: Object.freeze({
          ...qaJiraLocalSeedRefs.sourceProfile,
          contentHash: sourceProfileHash,
        }),
      });
    }
    return Object.freeze({ ...entry });
  });
  if (primaryCount !== 1) throw new Error("QA_JIRA_SOURCE_PRIMARY_BINDING_REQUIRED");
  if (sourceCount !== 1) throw new Error("QA_JIRA_SOURCE_CONTEXT_BINDING_REQUIRED");
  const binding = Object.freeze({
    ...currentBinding,
    entries: Object.freeze(entries),
    previousRef: Object.freeze({
      id: published.binding.revisionId,
      version: published.binding.version,
      contentHash: published.binding.contentHash,
    }),
  });

  return Object.freeze({
    refs: qaJiraLocalSeedRefs,
    profile: Object.freeze({
      revisionId: qaJiraLocalSeedIds.profileSourcePolicyRevision,
      headerId: qaJiraLocalSeedRefs.profile.id,
      version: qaJiraLocalSeedRefs.profile.version,
      content: profile,
      contentHash: profileHash,
    }),
    sourceMapping: Object.freeze({
      revisionId: qaJiraLocalSeedIds.sourceMappingRevision,
      headerId: qaJiraLocalSeedRefs.sourceMapping.id,
      version: qaJiraLocalSeedRefs.sourceMapping.version,
      content: sourceMapping,
      contentHash: sourceMappingHash,
    }),
    sourceProfile: Object.freeze({
      revisionId: qaJiraLocalSeedIds.sourceProfileRevision,
      headerId: qaJiraLocalSeedRefs.sourceProfile.id,
      version: qaJiraLocalSeedRefs.sourceProfile.version,
      content: sourceProfile,
      contentHash: sourceProfileHash,
    }),
    binding: Object.freeze({
      revisionId: qaJiraLocalSeedIds.alphaBindingSourceRevision,
      headerId: qaJiraLocalSeedRefs.binding.id,
      version: qaJiraLocalSeedRefs.binding.version,
      content: binding,
      contentHash: digest(binding),
    }),
  });
}

async function loadCurrentPublished(
  runner: QueryRunner,
  table:
    | "connection_revisions"
    | "connector_mapping_revisions"
    | "connector_profile_revisions"
    | "project_integration_binding_revisions",
  headerTable:
    | "connection_headers"
    | "connector_mapping_headers"
    | "connector_profile_headers"
    | "project_integration_binding_headers",
  headerId: string,
): Promise<
  Readonly<{ revisionId: string; version: number; content: JsonRecord; contentHash: string }>
> {
  const allowed = new Set([
    "connection_revisions:connection_headers",
    "connector_mapping_revisions:connector_mapping_headers",
    "connector_profile_revisions:connector_profile_headers",
    "project_integration_binding_revisions:project_integration_binding_headers",
  ]);
  if (!allowed.has(`${table}:${headerTable}`)) throw new Error("QA_JIRA_REVISION_TABLE_FORBIDDEN");
  const rows = (await runner.query(
    `SELECT r.id,r.version,r.content,r.content_hash FROM ${headerTable} h JOIN ${table} r ON r.header_id=h.id AND r.version=h.current_published_version WHERE h.id=$1 AND r.status='PUBLISHED'`,
    [headerId],
  )) as readonly Readonly<{
    id: string;
    version: number;
    content: unknown;
    content_hash: string;
  }>[];
  if (rows.length !== 1) throw new Error("QA_JIRA_PUBLISHED_PREDECESSOR_REQUIRED");
  return Object.freeze({
    revisionId: rows[0]!.id,
    version: rows[0]!.version,
    content: json<JsonRecord>(rows[0]!.content),
    contentHash: rows[0]!.content_hash,
  });
}

async function publishJiraBaseIntegration(
  runner: QueryRunner,
  environment: RuntimeEnvironment,
): Promise<void> {
  if (
    !new Set([
      "qa-jira-local",
      "qa-jira-mattermost-local",
      "qa-jira-gitlab-local",
      "qa-jira-gitlab-mattermost-local",
    ]).has(environment.composition) ||
    !environment.mockHubUrl
  ) {
    throw new Error("QA_JIRA_LOCAL_SEED_COMPOSITION_REQUIRED");
  }
  const now = "2026-08-31T00:00:00.000Z";
  const connectorKey = jiraConnectorManifest.metadata.key;
  const connection = await loadCurrentPublished(
    runner,
    "connection_revisions",
    "connection_headers",
    qaLocalSeedIds.connection,
  );
  const mapping = await loadCurrentPublished(
    runner,
    "connector_mapping_revisions",
    "connector_mapping_headers",
    qaLocalSeedIds.mapping,
  );
  const profile = await loadCurrentPublished(
    runner,
    "connector_profile_revisions",
    "connector_profile_headers",
    qaLocalSeedIds.profile,
  );
  const binding = await loadCurrentPublished(
    runner,
    "project_integration_binding_revisions",
    "project_integration_binding_headers",
    qaLocalSeedIds.alphaBinding,
  );
  const plan = buildQaJiraLocalRevisionPlan(
    { connection, mapping, profile, binding },
    environment.mockHubUrl,
  );

  const manifestHash = digest(jiraConnectorManifest);
  const registrations = (await runner.query(
    "SELECT id,manifest_hash FROM connector_registrations WHERE connector_key=$1 AND connector_version=$2",
    [connectorKey, jiraConnectorManifest.metadata.version],
  )) as readonly Readonly<{ id: string; manifest_hash: string }>[];
  if (registrations[0] && registrations[0].manifest_hash !== manifestHash) {
    throw new Error("QA_JIRA_CONNECTOR_REGISTRATION_CONFLICT");
  }
  const connectorRegistrationId = registrations[0]?.id ?? qaJiraLocalSeedIds.connector;
  if (!registrations[0]) {
    await runner.query(
      "INSERT INTO connector_registrations(id,connector_key,connector_version,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,$2,$3,$4,$5,'REGISTERED',$6)",
      [
        connectorRegistrationId,
        connectorKey,
        jiraConnectorManifest.metadata.version,
        JSON.stringify(jiraConnectorManifest),
        manifestHash,
        now,
      ],
    );
  }
  for (const operation of ["request.create", "request.transition", "defect.create"] as const) {
    await runner.query(
      "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,'operational-work-item','1.0.0',$2,'jira.operational-authority.handler',$3,$4) ON CONFLICT DO NOTHING",
      [
        connectorRegistrationId,
        operation,
        JSON.stringify(["RECONCILIATION"]),
        JSON.stringify(["READ_BACK"]),
      ],
    );
  }

  for (const [table, revision] of [
    ["connection_revisions", plan.connection],
    ["connector_mapping_revisions", plan.mapping],
    ["connector_profile_revisions", plan.profile],
  ] as const) {
    await runner.query(
      `INSERT INTO ${table}(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,'PUBLISHED',$5,$6,$7)`,
      [
        revision.revisionId,
        localSeedIds.workspaceFunctional,
        revision.headerId,
        revision.version,
        JSON.stringify(revision.content),
        revision.contentHash,
        now,
      ],
    );
  }
  await runner.query(
    "UPDATE project_integration_binding_revisions SET status='RETIRED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
    [localSeedIds.workspaceFunctional, localSeedIds.alpha, plan.binding.headerId],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8)",
    [
      plan.binding.revisionId,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      plan.binding.headerId,
      plan.binding.version,
      JSON.stringify(plan.binding.content),
      plan.binding.contentHash,
      now,
    ],
  );

  for (const [table, headerId, version] of [
    ["connection_headers", plan.connection.headerId, plan.connection.version],
    ["connector_mapping_headers", plan.mapping.headerId, plan.mapping.version],
    ["connector_profile_headers", plan.profile.headerId, plan.profile.version],
    ["project_integration_binding_headers", plan.binding.headerId, plan.binding.version],
  ] as const) {
    await runner.query(
      `UPDATE ${table} SET current_published_version=$2,row_version=row_version+1 WHERE id=$1 AND current_published_version<$2`,
      [headerId, version],
    );
  }

  for (const [id, kind, revision, projectId] of [
    [qaJiraLocalSeedIds.connectionValidation, "CONNECTION", plan.connection, null],
    [qaJiraLocalSeedIds.mappingValidation, "MAPPING", plan.mapping, null],
    [qaJiraLocalSeedIds.profileValidation, "PROFILE", plan.profile, null],
    [qaJiraLocalSeedIds.alphaBindingValidation, "BINDING", plan.binding, localSeedIds.alpha],
  ] as const) {
    await runner.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,$4,$5,$6,'VALID',$7,$8,$9)",
      [
        id,
        localSeedIds.workspaceFunctional,
        projectId,
        kind,
        revision.headerId,
        revision.version,
        revision.contentHash,
        JSON.stringify({ checks: [{ key: "jira-exact-immutable-chain", outcome: "PASS" }] }),
        now,
      ],
    );
  }
}

async function publishJiraSourceIntegration(
  runner: QueryRunner,
  environment: RuntimeEnvironment,
): Promise<void> {
  if (
    !new Set([
      "qa-jira-local",
      "qa-jira-mattermost-local",
      "qa-jira-gitlab-local",
      "qa-jira-gitlab-mattermost-local",
    ]).has(environment.composition) ||
    !environment.mockHubUrl
  ) {
    throw new Error("QA_JIRA_LOCAL_SEED_COMPOSITION_REQUIRED");
  }
  const now = "2026-08-31T01:00:00.000Z";
  const connection = await loadCurrentPublished(
    runner,
    "connection_revisions",
    "connection_headers",
    qaLocalSeedIds.connection,
  );
  const mapping = await loadCurrentPublished(
    runner,
    "connector_mapping_revisions",
    "connector_mapping_headers",
    qaLocalSeedIds.mapping,
  );
  const profile = await loadCurrentPublished(
    runner,
    "connector_profile_revisions",
    "connector_profile_headers",
    qaLocalSeedIds.profile,
  );
  const binding = await loadCurrentPublished(
    runner,
    "project_integration_binding_revisions",
    "project_integration_binding_headers",
    qaLocalSeedIds.alphaBinding,
  );
  const plan = buildQaJiraLocalSourceRevisionPlan({ connection, mapping, profile, binding });

  for (const [table, id, key] of [
    ["connector_mapping_headers", plan.sourceMapping.headerId, "qa-jira-source-context-mapping"],
    ["connector_profile_headers", plan.sourceProfile.headerId, "qa-jira-source-context-profile"],
  ] as const) {
    await runner.query(
      `INSERT INTO ${table}(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,NULL)`,
      [id, localSeedIds.workspaceFunctional, key],
    );
  }

  for (const [table, revision] of [
    ["connector_profile_revisions", plan.profile],
    ["connector_mapping_revisions", plan.sourceMapping],
    ["connector_profile_revisions", plan.sourceProfile],
  ] as const) {
    await runner.query(
      `INSERT INTO ${table}(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,'PUBLISHED',$5,$6,$7)`,
      [
        revision.revisionId,
        localSeedIds.workspaceFunctional,
        revision.headerId,
        revision.version,
        JSON.stringify(revision.content),
        revision.contentHash,
        now,
      ],
    );
  }
  await runner.query(
    "UPDATE project_integration_binding_revisions SET status='RETIRED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
    [localSeedIds.workspaceFunctional, localSeedIds.alpha, plan.binding.headerId],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8)",
    [
      plan.binding.revisionId,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      plan.binding.headerId,
      plan.binding.version,
      JSON.stringify(plan.binding.content),
      plan.binding.contentHash,
      now,
    ],
  );

  for (const [table, headerId, version] of [
    ["connector_profile_headers", plan.profile.headerId, plan.profile.version],
    ["connector_mapping_headers", plan.sourceMapping.headerId, plan.sourceMapping.version],
    ["connector_profile_headers", plan.sourceProfile.headerId, plan.sourceProfile.version],
    ["project_integration_binding_headers", plan.binding.headerId, plan.binding.version],
  ] as const) {
    await runner.query(
      `UPDATE ${table} SET current_published_version=$2,row_version=row_version+1 WHERE id=$1 AND (current_published_version IS NULL OR current_published_version<$2)`,
      [headerId, version],
    );
    const current = (await runner.query(
      `SELECT current_published_version FROM ${table} WHERE id=$1`,
      [headerId],
    )) as readonly Readonly<{ current_published_version: number }>[];
    if (Number(current[0]?.current_published_version) !== version) {
      throw new Error("QA_JIRA_SOURCE_HEADER_ADVANCE_FAILED");
    }
  }

  for (const [id, kind, revision, projectId] of [
    [qaJiraLocalSeedIds.profileSourcePolicyValidation, "PROFILE", plan.profile, null],
    [qaJiraLocalSeedIds.sourceMappingValidation, "MAPPING", plan.sourceMapping, null],
    [qaJiraLocalSeedIds.sourceProfileValidation, "PROFILE", plan.sourceProfile, null],
    [qaJiraLocalSeedIds.alphaBindingSourceValidation, "BINDING", plan.binding, localSeedIds.alpha],
  ] as const) {
    await runner.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,$4,$5,$6,'VALID',$7,$8,$9)",
      [
        id,
        localSeedIds.workspaceFunctional,
        projectId,
        kind,
        revision.headerId,
        revision.version,
        revision.contentHash,
        JSON.stringify({
          checks: [{ key: "jira-source-context-exact-immutable-chain", outcome: "PASS" }],
        }),
        now,
      ],
    );
  }
}

async function seedVerifiedJiraImportIdentity(runner: QueryRunner): Promise<void> {
  const now = "2026-08-31T02:00:00.000Z";
  const evidence = Object.freeze({
    providerNamespace: "jira.local",
    externalPrincipalId: "jira-user-requester-alpha",
    principalId: localPersonaIds["requester.alpha"],
    method: "LOCAL_FIXTURE_VERIFICATION",
  });
  await runner.query(
    `INSERT INTO external_principal_bindings(
       id,workspace_id,connection_header_id,provider_namespace,external_principal_kind,
       external_principal_id,principal_id,state,verification_method,verification_evidence_hash,
       verified_by,verified_at,resource_version,created_at,updated_at
     ) VALUES($1,$2,$3,'jira.local','EXTERNAL_HUMAN',$4,$5,'VERIFIED',
       'LOCAL_FIXTURE_VERIFICATION',$6,$7,$8,1,$8,$8)
     ON CONFLICT(id) DO NOTHING`,
    [
      qaJiraLocalSeedIds.requesterExternalPrincipalBinding,
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.connection,
      evidence.externalPrincipalId,
      evidence.principalId,
      digest(evidence),
      localPersonaIds["owner.local"],
      now,
    ],
  );
  const stored = (await runner.query(
    `SELECT principal_id,state FROM external_principal_bindings
      WHERE workspace_id=$1 AND connection_header_id=$2 AND provider_namespace='jira.local'
        AND external_principal_kind='EXTERNAL_HUMAN' AND external_principal_id=$3`,
    [localSeedIds.workspaceFunctional, qaLocalSeedIds.connection, evidence.externalPrincipalId],
  )) as readonly Readonly<{ principal_id: string; state: string }>[];
  if (
    stored.length !== 1 ||
    stored[0]!.principal_id !== evidence.principalId ||
    stored[0]!.state !== "VERIFIED"
  ) {
    throw new Error("QA_JIRA_IMPORT_IDENTITY_SEED_CONFLICT");
  }
}

export async function runQaJiraLocalSeed(
  dataSource: DataSource,
  environment: RuntimeEnvironment,
): Promise<QaLocalSeedResult> {
  await runQaLocalSeed(dataSource);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const marker = (await runner.query(
      "SELECT version FROM local_seed_markers WHERE key=$1 FOR UPDATE",
      [QA_JIRA_LOCAL_SEED_KEY],
    )) as readonly Readonly<{ version: number }>[];
    const markerVersion = marker[0]?.version ?? 0;
    if (markerVersion === QA_JIRA_LOCAL_SEED_VERSION) {
      await runner.commitTransaction();
      return "unchanged";
    }
    if (markerVersion > QA_JIRA_LOCAL_SEED_VERSION) {
      throw new Error("QA_JIRA_LOCAL_SEED_VERSION_AHEAD");
    }
    if (markerVersion < QA_JIRA_LOCAL_BASE_SEED_VERSION) {
      await publishJiraBaseIntegration(runner, environment);
    }
    if (markerVersion < QA_JIRA_LOCAL_SOURCE_SEED_VERSION) {
      await publishJiraSourceIntegration(runner, environment);
    }
    if (markerVersion < QA_JIRA_LOCAL_SEED_VERSION) {
      await seedVerifiedJiraImportIdentity(runner);
    }
    await runner.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at",
      [QA_JIRA_LOCAL_SEED_KEY, QA_JIRA_LOCAL_SEED_VERSION],
    );
    await runner.commitTransaction();
    return "applied";
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
