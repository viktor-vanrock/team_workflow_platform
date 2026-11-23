import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { createQaTypeOrmDefectConfirmationHook } from "@awp/competency-qa/node";
import {
  createJiraDialect,
  createJiraHttpRequestCreatePort,
  JiraDefectCreateService,
  JiraRestClient,
  type RequestSubEffect,
} from "@awp/connector-jira";
import {
  JiraEffectRepository,
  PersistentJiraRequestCreatePort,
  PersistentJiraRequestSubEffectStore,
} from "@awp/connector-jira-persistence-typeorm";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ActorReference,
  type AuthorizationBasisRef,
  type CommandConfigurationPin,
  type ConnectorCommand,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  validateAuthorizationBasis,
} from "@awp/platform-core";
import {
  TypeOrmCommandDeliveryStore,
  TypeOrmIdentityRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

import { isQaJiraLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";

type Row = Readonly<Record<string, unknown>>;
type ExactRef = Readonly<{ id: string; version: number; contentHash?: string }>;

interface DefectTarget {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityKind: "DEFECT";
  readonly authorityScopeKey: string;
  readonly naturalKey: string;
  readonly externalProjectId: string;
  readonly externalIssueTypeId: string;
}

interface DefectPayload {
  readonly sourceWorkItemId: string;
  readonly summary: string;
  readonly description: string;
  readonly dataClassificationKey: string;
  readonly sourceRefs: readonly Readonly<Record<string, unknown>>[];
}

interface ResolvedDefectConfiguration {
  readonly pins: readonly CommandConfigurationPin[];
  readonly profileRefs: readonly ExactRef[];
  readonly endpoint: string;
  readonly adapterFamily: "jira-cloud-v3" | "jira-dc-9-v2" | "jira-dc-10-v2" | "jira-dc-11-v2";
  readonly markerFieldId: string;
  readonly connectionRef: ExactRef;
  readonly profileRef: ExactRef;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function record(value: unknown, code: string): Row {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
  return parsed as Row;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value;
}

function exactRef(value: unknown, code: string): ExactRef {
  const parsed = record(value, code);
  const version = Number(parsed.version);
  if (typeof parsed.id !== "string" || !Number.isSafeInteger(version) || version < 1)
    throw new Error(code);
  return Object.freeze({
    id: parsed.id,
    version,
    ...(typeof parsed.contentHash === "string" ? { contentHash: parsed.contentHash } : {}),
  });
}

function sameRef(left: ExactRef, right: ExactRef): boolean {
  return left.id === right.id && left.version === right.version;
}

function uniqueRefs(
  values: readonly Readonly<{ id: string; version: number }>[],
): readonly Readonly<{ id: string; version: number }>[] {
  return Object.freeze([
    ...new Map(
      values.map((value) => [`${value.id}:${value.version}`, Object.freeze({ ...value })]),
    ).values(),
  ]);
}

function target(value: unknown): DefectTarget {
  const parsed = record(value, "JIRA_DEFECT_TARGET_INVALID");
  if (parsed.entityKind !== "DEFECT") throw new Error("JIRA_DEFECT_TARGET_KIND_INVALID");
  return Object.freeze({
    workspaceId: text(parsed.workspaceId, "JIRA_DEFECT_TARGET_WORKSPACE_REQUIRED"),
    projectId: text(parsed.projectId, "JIRA_DEFECT_TARGET_PROJECT_REQUIRED"),
    entityKind: "DEFECT",
    authorityScopeKey: text(parsed.authorityScopeKey, "JIRA_DEFECT_AUTHORITY_SCOPE_REQUIRED"),
    naturalKey: text(parsed.naturalKey, "JIRA_DEFECT_NATURAL_KEY_REQUIRED"),
    externalProjectId: text(parsed.externalProjectId, "JIRA_DEFECT_EXTERNAL_PROJECT_REQUIRED"),
    externalIssueTypeId: text(
      parsed.externalIssueTypeId,
      "JIRA_DEFECT_EXTERNAL_ISSUE_TYPE_REQUIRED",
    ),
  });
}

function payload(value: unknown): DefectPayload {
  const parsed = record(value, "JIRA_DEFECT_PAYLOAD_INVALID");
  if (!Array.isArray(parsed.sourceRefs) || parsed.sourceRefs.length === 0)
    throw new Error("JIRA_DEFECT_SOURCE_REFS_REQUIRED");
  return Object.freeze({
    sourceWorkItemId: text(parsed.sourceWorkItemId, "JIRA_DEFECT_SOURCE_WORK_ITEM_REQUIRED"),
    summary: text(parsed.summary, "JIRA_DEFECT_SUMMARY_REQUIRED"),
    description: text(parsed.description, "JIRA_DEFECT_DESCRIPTION_REQUIRED"),
    dataClassificationKey: text(
      parsed.dataClassificationKey,
      "JIRA_DEFECT_CLASSIFICATION_REQUIRED",
    ),
    sourceRefs: Object.freeze(
      parsed.sourceRefs.map((value) => record(value, "JIRA_DEFECT_SOURCE_REF_INVALID")),
    ),
  });
}

async function publishedRevision(
  manager: EntityManager,
  table:
    | "project_integration_binding_revisions"
    | "connector_profile_revisions"
    | "connector_mapping_revisions"
    | "connection_revisions",
  workspaceId: string,
  projectId: string,
  reference: ExactRef,
): Promise<Readonly<{ content: Row; contentHash: string }>> {
  const projectClause =
    table === "project_integration_binding_revisions" ? " AND project_id=$4" : "";
  const rows = (await manager.query(
    `SELECT content,content_hash FROM ${table} WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'${projectClause}`,
    projectClause
      ? [workspaceId, reference.id, reference.version, projectId]
      : [workspaceId, reference.id, reference.version],
  )) as readonly Row[];
  if (rows.length !== 1) throw new Error("JIRA_DEFECT_CONFIGURATION_REVISION_NOT_FOUND");
  const result = Object.freeze({
    content: record(rows[0]!.content, "JIRA_DEFECT_CONFIGURATION_CONTENT_INVALID"),
    contentHash: String(rows[0]!.content_hash),
  });
  if (reference.contentHash && reference.contentHash !== result.contentHash)
    throw new Error("JIRA_DEFECT_CONFIGURATION_REF_HASH_MISMATCH");
  return result;
}

async function assertValidation(
  manager: EntityManager,
  workspaceId: string,
  projectId: string,
  kind: "BINDING" | "PROFILE" | "MAPPING" | "CONNECTION",
  reference: ExactRef,
  contentHash: string,
): Promise<void> {
  const rows = (await manager.query(
    "SELECT outcome,content_hash FROM integration_validation_reports WHERE workspace_id=$1 AND subject_kind=$2 AND subject_id=$3 AND subject_version=$4 AND (project_id IS NULL OR project_id=$5) ORDER BY created_at DESC LIMIT 1",
    [workspaceId, kind, reference.id, reference.version, projectId],
  )) as readonly Row[];
  if (rows[0]?.outcome !== "VALID" || rows[0]?.content_hash !== contentHash)
    throw new Error(`JIRA_DEFECT_${kind}_VALIDATION_REQUIRED`);
}

export class QaJiraDefectPublicationService {
  readonly #effects: JiraEffectRepository;
  readonly #effectLeaseOwner = randomUUID();

  constructor(
    private readonly source: DataSource,
    private readonly environment: RuntimeEnvironment,
  ) {
    if (!isQaJiraLocalComposition(environment.composition) || !environment.mockHubUrl)
      throw new Error("QA_JIRA_DEFECT_COMPOSITION_REQUIRED");
    this.#effects = new JiraEffectRepository(source);
  }

  async revalidate(command: ConnectorCommand): Promise<
    Readonly<{
      evaluatedAt: Date;
      authorizationBasis: AuthorizationBasisRef;
      authorizationBasisHash: string;
      configuration: ResolvedDefectConfiguration;
    }>
  > {
    if (
      command.capability.operation !== "defect.create" ||
      command.commandType !== "qa.defect.create" ||
      command.actor.kind !== "HUMAN"
    )
      throw new Error("JIRA_DEFECT_COMMAND_INVALID");
    if (!command.approvalId || command.effectAuthorizationStatus !== "CONSUMED")
      throw new Error("JIRA_DEFECT_APPROVAL_REQUIRED");
    const exactTarget = target(command.target);
    if (
      exactTarget.workspaceId !== command.workspaceId ||
      exactTarget.projectId !== command.projectId
    )
      throw new Error("JIRA_DEFECT_SCOPE_MISMATCH");
    const authorization = await this.#authorize(
      command.workspaceId,
      command.projectId,
      command.actor.subject,
    );
    if (authorization.actor.principalId !== command.actor.principalId)
      throw new Error("JIRA_DEFECT_ACTOR_CHANGED");
    const configuration = await this.#resolveAndPin(command, exactTarget);
    const evaluatedAt = new Date();
    return Object.freeze({
      evaluatedAt,
      authorizationBasis: authorization.basis,
      authorizationBasisHash: sha256(authorization.basis as unknown as JsonValue),
      configuration,
    });
  }

  async execute(
    command: ConnectorCommand,
    configuration: ResolvedDefectConfiguration,
    delivery: TypeOrmCommandDeliveryStore,
  ): Promise<void> {
    if (!command.executionLeaseExpiresAt) throw new Error("JIRA_DEFECT_EXECUTION_LEASE_REQUIRED");
    const exactTarget = target(command.target);
    const exactPayload = payload(command.payload);
    await this.#effects.ensure({
      id: deterministicUuid(`jira-defect-effect:${command.effectIdempotencyKey}`),
      commandId: command.id,
      effectId: command.effectIdempotencyKey,
      connectionRef: configuration.connectionRef,
      profileRef: configuration.profileRef,
      operation: "defect.create",
      targetHash: command.targetHash,
      payloadHash: command.payloadHash,
      marker: command.effectIdempotencyKey,
      now: new Date(),
    });
    const claim = await this.#effects.claim(
      command.effectIdempotencyKey,
      `${this.#effectLeaseOwner}:${command.attemptCount}`,
      new Date(),
      command.executionLeaseExpiresAt,
    );
    await this.#markDraftDispatched(command);

    const endpoint = new URL(configuration.endpoint);
    const client = new JiraRestClient({
      baseUrl: endpoint.toString(),
      environment: "LOCAL",
      allowedOrigins: [endpoint.origin],
      allowedLocalHostnames: [endpoint.hostname],
      transport: fetch,
    });
    const rawPort = createJiraHttpRequestCreatePort({
      client,
      dialect: createJiraDialect(configuration.adapterFamily),
      projectId: exactTarget.externalProjectId,
      issueTypeId: exactTarget.externalIssueTypeId,
      markerFieldId: configuration.markerFieldId,
      authorityFieldIds: ["summary", "description", "status", configuration.markerFieldId],
      issueLinkTypeId: "10000",
      issueLinkDirection: "OUTWARD",
    });
    const port = new PersistentJiraRequestCreatePort(rawPort, this.#effects, claim);
    const receipts = new PersistentJiraRequestSubEffectStore(this.#effects, claim);
    const service = new JiraDefectCreateService(port, receipts);
    const subEffects = await this.#subEffects(command, exactPayload);
    const outcome = await service.execute({
      effectMarker: command.effectIdempotencyKey,
      fields: Object.freeze({
        summary: exactPayload.summary,
        description: exactPayload.description,
      }),
      subEffects,
    });
    if (outcome.status !== "CONFIRMED") throw new Error(`JIRA_DEFECT_${outcome.reasonCode}`);
    const observedAt =
      typeof outcome.observation.providerUpdatedAt === "string"
        ? outcome.observation.providerUpdatedAt
        : new Date().toISOString();
    const result = Object.freeze({
      operation: "defect.create" as const,
      entityKind: "DEFECT" as const,
      externalEntityId: outcome.observation.externalEntityId,
      externalDisplayKey: outcome.observation.externalDisplayKey,
      externalVersion: outcome.observation.externalRevisionToken,
      rawExternalState: "Open",
      normalizedStatus: "NEW" as const,
      naturalKey: exactTarget.naturalKey,
      effectId: command.effectIdempotencyKey,
      observedAt,
      scope: Object.freeze({ workspaceId: command.workspaceId, projectId: command.projectId }),
      profileRef: command.profileRef,
      subEffectReceipts: outcome.subEffectReceipts,
    });
    const hook = createQaTypeOrmDefectConfirmationHook();
    await delivery.confirmWith(
      { workspaceId: command.workspaceId, projectId: command.projectId, commandId: command.id },
      result,
      new Date(),
      async (manager) => {
        await hook.apply(
          {
            workspaceId: command.workspaceId,
            projectId: command.projectId,
            commandId: command.id,
            effectIdempotencyKey: command.effectIdempotencyKey,
            capabilityKey: command.capability.key,
            capabilityVersion: command.capability.exactContractVersion,
            operation: "defect.create",
            result,
            source: command.source,
            bindingRef: command.bindingRef,
            profileRefs: configuration.profileRefs,
            correlationId: command.correlationId,
            causationId: command.causationId,
            resultRefs: {
              confirmationReceiptId: deterministicUuid(`${command.id}:defect-confirmation`),
              operationalResultId: deterministicUuid(`${command.id}:defect-result`),
            },
          },
          {
            transactionId: deterministicUuid(`${command.id}:defect-transaction`),
            native: manager,
            contributionKey: hook.key,
            idempotencyKey: `${command.id}:confirmation:${hook.key}`,
          },
        );
      },
      { attemptCount: command.attemptCount, leaseExpiresAt: command.executionLeaseExpiresAt },
    );
  }

  async #resolveAndPin(
    command: ConnectorCommand,
    exactTarget: DefectTarget,
  ): Promise<ResolvedDefectConfiguration> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const bindingRef = exactRef(command.bindingRef, "JIRA_DEFECT_BINDING_REF_INVALID");
      const binding = await publishedRevision(
        manager,
        "project_integration_binding_revisions",
        command.workspaceId,
        command.projectId,
        bindingRef,
      );
      await assertValidation(
        manager,
        command.workspaceId,
        command.projectId,
        "BINDING",
        bindingRef,
        binding.contentHash,
      );
      const entries = Array.isArray(binding.content.entries)
        ? binding.content.entries.map((value) => record(value, "JIRA_DEFECT_BINDING_ENTRY_INVALID"))
        : [];
      const primaryEntry = entries.filter((entry) => entry.logicalRole === "DEFECT_DESTINATION");
      const auxiliaryEntry = entries.filter(
        (entry) => entry.logicalRole === "QA_REQUEST_AUTHORITY",
      );
      if (primaryEntry.length !== 1 || auxiliaryEntry.length !== 1)
        throw new Error("JIRA_DEFECT_AUTHORITY_CHAIN_INVALID");
      const pins: CommandConfigurationPin[] = [];
      const profileRefs: ExactRef[] = [];
      let runtime: Omit<ResolvedDefectConfiguration, "pins" | "profileRefs"> | undefined;
      for (const [sequence, purpose, logicalRole, entry] of [
        [0, "PRIMARY", "DEFECT_DESTINATION", primaryEntry[0]!],
        [1, "AUXILIARY", "QA_REQUEST_AUTHORITY", auxiliaryEntry[0]!],
      ] as const) {
        const profileRef = exactRef(entry.profileRef, "JIRA_DEFECT_PROFILE_REF_INVALID");
        if (
          sequence === 0 &&
          !sameRef(
            profileRef,
            exactRef(command.profileRef, "JIRA_DEFECT_COMMAND_PROFILE_REF_INVALID"),
          )
        )
          throw new Error("JIRA_DEFECT_PRIMARY_PROFILE_MISMATCH");
        const profile = await publishedRevision(
          manager,
          "connector_profile_revisions",
          command.workspaceId,
          command.projectId,
          profileRef,
        );
        const mappingRef = exactRef(profile.content.mappingRef, "JIRA_DEFECT_MAPPING_REF_INVALID");
        const connectionRef = exactRef(
          profile.content.connectionRef,
          "JIRA_DEFECT_CONNECTION_REF_INVALID",
        );
        const mapping = await publishedRevision(
          manager,
          "connector_mapping_revisions",
          command.workspaceId,
          command.projectId,
          mappingRef,
        );
        const connection = await publishedRevision(
          manager,
          "connection_revisions",
          command.workspaceId,
          command.projectId,
          connectionRef,
        );
        await assertValidation(
          manager,
          command.workspaceId,
          command.projectId,
          "PROFILE",
          profileRef,
          profile.contentHash,
        );
        await assertValidation(
          manager,
          command.workspaceId,
          command.projectId,
          "MAPPING",
          mappingRef,
          mapping.contentHash,
        );
        await assertValidation(
          manager,
          command.workspaceId,
          command.projectId,
          "CONNECTION",
          connectionRef,
          connection.contentHash,
        );
        if (
          profile.content.connectorKey !== "jira.operational-authority" ||
          mapping.content.connectorKey !== "jira.operational-authority" ||
          connection.content.connectorKey !== "jira.operational-authority"
        )
          throw new Error("JIRA_DEFECT_CONNECTOR_CHAIN_MISMATCH");
        const endpoint = text(
          connection.content.endpoint ?? connection.content.baseUrl,
          "JIRA_DEFECT_ENDPOINT_REQUIRED",
        );
        if (
          !this.environment.mockHubUrl ||
          new URL(endpoint).origin !== new URL(this.environment.mockHubUrl).origin
        )
          throw new Error("JIRA_DEFECT_ENDPOINT_MISMATCH");
        const adapterFamily = text(
          connection.content.adapterFamily,
          "JIRA_DEFECT_ADAPTER_REQUIRED",
        ) as ResolvedDefectConfiguration["adapterFamily"];
        if (
          !new Set(["jira-cloud-v3", "jira-dc-9-v2", "jira-dc-10-v2", "jira-dc-11-v2"]).has(
            adapterFamily,
          )
        )
          throw new Error("JIRA_DEFECT_ADAPTER_UNSUPPORTED");
        const markerFieldId = text(
          profile.content.effectMarkerFieldId ?? connection.content.markerFieldId,
          "JIRA_DEFECT_MARKER_FIELD_REQUIRED",
        );
        const authorityNamespaceHash = sha256({
          endpointOrigin: new URL(endpoint).origin,
          externalProjectId: exactTarget.externalProjectId,
          externalIssueTypeId: exactTarget.externalIssueTypeId,
          logicalRole,
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
            bindingRef,
            bindingHash: binding.contentHash,
            profileRef,
            profileHash: profile.contentHash,
            mappingRef,
            mappingHash: mapping.contentHash,
            connectionRef,
            connectionHash: connection.contentHash,
            authorityNamespaceHash,
          } as JsonValue),
          adapterFamily,
          adapterContractVersion: text(
            connection.content.adapterContractVersion,
            "JIRA_DEFECT_ADAPTER_VERSION_REQUIRED",
          ),
          authorityNamespaceHash,
        });
        pins.push(pin);
        profileRefs.push(profileRef);
        if (sequence === 0)
          runtime = Object.freeze({
            endpoint,
            adapterFamily,
            markerFieldId,
            connectionRef,
            profileRef,
          });
        await manager.query(
          "INSERT INTO connector_command_configuration_pins(command_id,sequence,purpose,requirement_key,logical_role,project_integration_binding_ref,connector_profile_ref,mapping_ref,connection_ref,content_hash,adapter_family,adapter_contract_version,authority_namespace_hash) VALUES($1,$2,$3,'defect-destination',$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(command_id,sequence) DO NOTHING",
          [
            command.id,
            pin.sequence,
            pin.purpose,
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
      }
      if (!runtime) throw new Error("JIRA_DEFECT_PRIMARY_RUNTIME_REQUIRED");
      const stored = (await manager.query(
        "SELECT sequence,logical_role,content_hash FROM connector_command_configuration_pins WHERE command_id=$1 ORDER BY sequence",
        [command.id],
      )) as readonly Row[];
      if (
        stored.length !== pins.length ||
        stored.some(
          (row, index) =>
            Number(row.sequence) !== index ||
            row.logical_role !== pins[index]!.logicalRole ||
            row.content_hash !== pins[index]!.contentHash,
        )
      )
        throw new Error("JIRA_DEFECT_CONFIGURATION_PIN_CONFLICT");
      const expected = record(command.expectedExternalState, "JIRA_DEFECT_EXPECTED_STATE_INVALID");
      const chain = Array.isArray(expected.configurationChain)
        ? expected.configurationChain.map((value) =>
            record(value, "JIRA_DEFECT_EXPECTED_CHAIN_INVALID"),
          )
        : [];
      if (
        chain.length !== 2 ||
        chain.some(
          (entry, index) =>
            entry.logicalRole !== pins[index]!.logicalRole ||
            !sameRef(
              exactRef(entry.profileRef, "JIRA_DEFECT_EXPECTED_PROFILE_INVALID"),
              pins[index]!.profileRef,
            ),
        )
      )
        throw new Error("JIRA_DEFECT_APPROVED_CHAIN_MISMATCH");
      return Object.freeze({
        ...runtime,
        pins: Object.freeze(pins),
        profileRefs: Object.freeze(profileRefs),
      });
    });
  }

  async #markDraftDispatched(command: ConnectorCommand): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        "SELECT state FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND command_ref->>'id'=$3 FOR UPDATE",
        [command.workspaceId, command.projectId, command.id],
      )) as readonly Row[];
      const draft = rows[0];
      if (!draft) throw new Error("JIRA_DEFECT_DRAFT_NOT_FOUND");
      if (draft.state === "DISPATCHED") return;
      if (draft.state !== "AUTHORIZED") throw new Error("JIRA_DEFECT_DRAFT_NOT_AUTHORIZED");
      await manager.query(
        "UPDATE qa_defect_drafts SET state='DISPATCHED',effect_key_hash=$1,resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$2 AND project_id=$3 AND command_ref->>'id'=$4 AND state='AUTHORIZED'",
        [
          sha256(command.effectIdempotencyKey as JsonValue),
          command.workspaceId,
          command.projectId,
          command.id,
        ],
      );
    });
  }

  async #subEffects(
    command: ConnectorCommand,
    exactPayload: DefectPayload,
  ): Promise<readonly RequestSubEffect[]> {
    const rows = (await this.source.query(
      `SELECT d.session_id,b.external_entity_id
         FROM qa_defect_drafts d
         JOIN operational_bindings b ON b.workspace_id=d.workspace_id AND b.project_id=d.project_id AND b.work_item_id=d.work_item_id
        WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.command_ref->>'id'=$3`,
      [command.workspaceId, command.projectId, command.id],
    )) as readonly Row[];
    const source = rows[0];
    if (!source) throw new Error("JIRA_DEFECT_REQUEST_AUTHORITY_LINK_REQUIRED");
    const effects: RequestSubEffect[] = [
      Object.freeze({
        kind: "LINK",
        semanticIdentity: `request:${String(source.external_entity_id)}`,
        payload: Object.freeze({ externalEntityId: String(source.external_entity_id) }),
      }),
      Object.freeze({
        kind: "COMMENT",
        semanticIdentity: `session:${String(source.session_id)}`,
        payload: Object.freeze({ reference: `QA session ${String(source.session_id)}` }),
      }),
    ];
    for (const reference of exactPayload.sourceRefs) {
      if (reference.kind === "ARTIFACT") {
        const id = text(reference.id, "JIRA_DEFECT_EVIDENCE_REF_ID_REQUIRED");
        effects.push(
          Object.freeze({
            kind: "COMMENT",
            semanticIdentity: `evidence:${id}`,
            payload: Object.freeze({ reference: `QA evidence ${id}` }),
          }),
        );
      }
    }
    return Object.freeze(effects);
  }

  async #authorize(
    workspaceId: string,
    projectId: string,
    subject: string,
  ): Promise<
    Readonly<{ actor: Extract<ActorReference, { kind: "HUMAN" }>; basis: AuthorizationBasisRef }>
  > {
    const identities = new TypeOrmIdentityRepository(this.source);
    const identity = await identities.findByVerifiedSubject(
      this.environment.identityIssuer,
      subject,
    );
    if (!identity || identity.kind !== "HUMAN") throw new Error("JIRA_DEFECT_IDENTITY_REQUIRED");
    const actor = Object.freeze({
      kind: "HUMAN" as const,
      principalId: identity.id,
      issuer: identity.issuer,
      subject: identity.subject,
    });
    const scope = Object.freeze({ kind: "PROJECT" as const, workspaceId, projectId });
    const access = new TypeOrmScopedAccessRepository(this.source);
    const project = await access.getProject(scope);
    if (!project || project.state !== "ACTIVE") throw new Error("JIRA_DEFECT_PROJECT_DENIED");
    const now = new Date();
    const facts = await access.authorizationFacts(scope, identity.id, now);
    const result = new DenyByDefaultAuthorizationPolicy(defaultClassificationCatalog).decide({
      context: { actor, scope, correlationId: randomUUID(), causationId: randomUUID() },
      permission: "qa.defect.publish",
      resourceClassification: project.classification,
      facts,
      policyVersion: "qa-defect-publication@1",
      at: now,
    });
    if (!result.allowed || !result.basis) throw new Error("JIRA_DEFECT_PERMISSION_DENIED");
    const basis: AuthorizationBasisRef = Object.freeze({
      kind: "PROJECT",
      policyVersion: "qa-defect-publication@1",
      membershipRef: result.basis.membershipRef,
      roleAssignmentRefs: uniqueRefs(result.basis.roleAssignmentRefs),
      entitlementRefs: uniqueRefs(result.basis.entitlementRefs),
      skillContext: "NOT_APPLICABLE",
    });
    validateAuthorizationBasis(scope, basis);
    return Object.freeze({ actor, basis });
  }
}
