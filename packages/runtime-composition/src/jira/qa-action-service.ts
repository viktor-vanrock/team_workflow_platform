import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  JiraRestClient,
  mapJiraAssignment,
  mapJiraDueDate,
  mapJiraPriority,
  mapJiraTransition,
} from "@awp/connector-jira";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ActorReference,
  type Approval,
  approveExternalCommand,
  assertOperationalActionRequest,
  type AuthorizationBasisRef,
  type CommandConfigurationPin,
  CommandGateway,
  type CompleteOperationalObservation,
  ConfigurationPinSet,
  type ConnectorCommand,
  consumeEffectAuthorization,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  type OperationalNormalizedAuthorityStatus,
  type OperationalObservationSource,
  prepareOperationalAction,
  recomputeExactApprovalSubjectHash,
  validateApprovalSnapshot,
  validateAuthorizationBasis,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";
import {
  TypeOrmCommandRepository,
  TypeOrmIdentityRepository,
  TypeOrmOperationalAuthorityRepository,
  TypeOrmScopedAccessRepository,
  TypeOrmUnitOfWork,
} from "@awp/platform-persistence-typeorm";

import { isQaJiraLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";

type Row = Readonly<Record<string, unknown>>;
type ActionOperation =
  "request.transition" | "request.assign" | "request.set-priority" | "request.set-due-date";
type ExactRef = Readonly<{ id: string; version: number; contentHash?: string }>;

interface JiraIssueDocument {
  readonly id: string;
  readonly key: string;
  readonly updated: string;
  readonly changelogId: string;
  readonly fields: Row;
}

interface ActionTarget {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly bindingId: string;
  readonly externalEntityId: string;
  readonly connectionHeaderId: string;
}

interface ActionExpected {
  readonly externalRevisionToken: string;
  readonly authorityFieldsHash: string;
  readonly expectedValueHash: string;
  readonly requestedValueHash: string;
  readonly fieldKey: "status" | "assignee" | "priority" | "dueDate";
  readonly projectionRevision: number;
  readonly configurationPinHash: string;
  readonly configurationPins: readonly CommandConfigurationPin[];
}

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function returnedRows(value: unknown): readonly Row[] {
  if (!Array.isArray(value)) return [];
  if (Array.isArray(value[0])) return value[0] as readonly Row[];
  return value.filter(
    (candidate): candidate is Row =>
      !!candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
}

function record(value: unknown, code: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Row;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value;
}

function ref(value: unknown, code: string): ExactRef {
  const parsed = record(json(value), code);
  if (
    typeof parsed.id !== "string" ||
    !Number.isSafeInteger(Number(parsed.version)) ||
    Number(parsed.version) < 1
  )
    throw new Error(code);
  return Object.freeze({
    id: parsed.id,
    version: Number(parsed.version),
    ...(typeof parsed.contentHash === "string" ? { contentHash: parsed.contentHash } : {}),
  });
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

function status(fields: Row): Readonly<{
  raw: Readonly<{ id: string; name: string }>;
  normalized: OperationalNormalizedAuthorityStatus;
}> {
  const raw = record(fields.status, "JIRA_ACTION_STATUS_REQUIRED");
  const id = text(raw.id, "JIRA_ACTION_STATUS_ID_REQUIRED");
  const name = text(raw.name, "JIRA_ACTION_STATUS_NAME_REQUIRED");
  if (id === "1") return Object.freeze({ raw: Object.freeze({ id, name }), normalized: "NEW" });
  if (id === "2") return Object.freeze({ raw: Object.freeze({ id, name }), normalized: "DONE" });
  throw new Error("JIRA_ACTION_STATUS_MAPPING_REQUIRED");
}

function actionField(operation: ActionOperation): ActionExpected["fieldKey"] {
  if (operation === "request.transition") return "status";
  if (operation === "request.assign") return "assignee";
  if (operation === "request.set-priority") return "priority";
  return "dueDate";
}

function fieldValueHash(
  fieldKey: ActionExpected["fieldKey"],
  observation: CompleteOperationalObservation,
): string {
  if (fieldKey === "status") return sha256({ statusId: observation.rawStatus.id });
  if (fieldKey === "assignee")
    return sha256({ externalPrincipalId: observation.assignee?.externalPrincipalId ?? null });
  if (fieldKey === "priority") return sha256({ rawId: observation.priority?.rawId ?? null });
  return sha256({ dueDate: observation.dueDate ?? null });
}

function exactTarget(value: unknown): ActionTarget {
  const target = record(value, "JIRA_ACTION_TARGET_INVALID");
  return Object.freeze({
    workspaceId: text(target.workspaceId, "JIRA_ACTION_TARGET_WORKSPACE_REQUIRED"),
    projectId: text(target.projectId, "JIRA_ACTION_TARGET_PROJECT_REQUIRED"),
    workItemId: text(target.workItemId, "JIRA_ACTION_TARGET_WORK_ITEM_REQUIRED"),
    bindingId: text(target.bindingId, "JIRA_ACTION_TARGET_BINDING_REQUIRED"),
    externalEntityId: text(target.externalEntityId, "JIRA_ACTION_TARGET_EXTERNAL_ID_REQUIRED"),
    connectionHeaderId: text(target.connectionHeaderId, "JIRA_ACTION_TARGET_CONNECTION_REQUIRED"),
  });
}

function exactExpected(value: unknown): ActionExpected {
  const expected = record(value, "JIRA_ACTION_EXPECTED_STATE_INVALID");
  const fieldKey = text(expected.fieldKey, "JIRA_ACTION_EXPECTED_FIELD_REQUIRED");
  if (!new Set(["status", "assignee", "priority", "dueDate"]).has(fieldKey))
    throw new Error("JIRA_ACTION_EXPECTED_FIELD_INVALID");
  const configurationPins = Array.isArray(expected.configurationPins)
    ? (expected.configurationPins as readonly CommandConfigurationPin[])
    : [];
  return Object.freeze({
    externalRevisionToken: text(
      expected.externalRevisionToken,
      "JIRA_ACTION_EXPECTED_REVISION_REQUIRED",
    ),
    authorityFieldsHash: text(
      expected.authorityFieldsHash,
      "JIRA_ACTION_EXPECTED_AUTHORITY_HASH_REQUIRED",
    ),
    expectedValueHash: text(expected.expectedValueHash, "JIRA_ACTION_EXPECTED_VALUE_HASH_REQUIRED"),
    requestedValueHash: text(
      expected.requestedValueHash,
      "JIRA_ACTION_REQUESTED_VALUE_HASH_REQUIRED",
    ),
    fieldKey: fieldKey as ActionExpected["fieldKey"],
    projectionRevision: Number(expected.projectionRevision),
    configurationPinHash: text(expected.configurationPinHash, "JIRA_ACTION_PIN_HASH_REQUIRED"),
    configurationPins,
  });
}

function parsedApproval(value: unknown): Approval {
  const stored = json<Record<string, unknown>>(value);
  const decision = stored.decision
    ? record(stored.decision, "APPROVAL_DECISION_INVALID")
    : undefined;
  return {
    ...stored,
    expiresAt: new Date(String(stored.expiresAt)),
    createdAt: new Date(String(stored.createdAt)),
    ...(decision
      ? { decision: { ...decision, decidedAt: new Date(String(decision.decidedAt)) } }
      : {}),
    ...(stored.invalidatedAt ? { invalidatedAt: new Date(String(stored.invalidatedAt)) } : {}),
    ...(stored.consumedAt ? { consumedAt: new Date(String(stored.consumedAt)) } : {}),
  } as unknown as Approval;
}

function persistedPin(row: Row): CommandConfigurationPin {
  const purpose = String(row.purpose);
  if (purpose !== "PRIMARY" && purpose !== "AUXILIARY")
    throw new Error("JIRA_ACTION_PIN_PURPOSE_INVALID");
  return Object.freeze({
    sequence: Number(row.sequence),
    purpose,
    logicalRole: String(row.logical_role),
    bindingRef: ref(row.project_integration_binding_ref, "JIRA_ACTION_BINDING_PIN_INVALID"),
    profileRef: ref(row.connector_profile_ref, "JIRA_ACTION_PROFILE_PIN_INVALID"),
    mappingRef: ref(row.mapping_ref, "JIRA_ACTION_MAPPING_PIN_INVALID"),
    connectionRef: ref(row.connection_ref, "JIRA_ACTION_CONNECTION_PIN_INVALID"),
    contentHash: String(row.content_hash) as `sha256:${string}`,
    adapterFamily: String(row.adapter_family),
    adapterContractVersion: String(row.adapter_contract_version),
    authorityNamespaceHash: String(row.authority_namespace_hash),
  });
}

export class QaJiraOperationalActionService {
  readonly #client: JiraRestClient;
  readonly #operational: TypeOrmOperationalAuthorityRepository;

  constructor(
    private readonly source: DataSource,
    private readonly environment: RuntimeEnvironment,
  ) {
    if (!isQaJiraLocalComposition(environment.composition) || !environment.mockHubUrl)
      throw new Error("QA_JIRA_LOCAL_ACTION_COMPOSITION_REQUIRED");
    const endpoint = new URL(environment.mockHubUrl);
    this.#client = new JiraRestClient({
      baseUrl: endpoint.toString(),
      environment: "LOCAL",
      allowedOrigins: [endpoint.origin],
      allowedLocalHostnames: [endpoint.hostname],
      transport: fetch,
    });
    this.#operational = new TypeOrmOperationalAuthorityRepository(source);
  }

  async prepare(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      operation: string;
      payload: unknown;
      ifMatch: string;
      idempotencyKey: string;
      actorSubject: string;
    }>,
  ): Promise<unknown> {
    if (
      !new Set<ActionOperation>([
        "request.transition",
        "request.assign",
        "request.set-priority",
        "request.set-due-date",
      ]).has(input.operation as ActionOperation)
    )
      throw new Error("OPERATIONAL_ACTION_UNSUPPORTED");
    const operation = input.operation as ActionOperation;
    assertOperationalActionRequest({ operation, payload: input.payload, ifMatch: input.ifMatch });
    const authorization = await this.#authorize(
      input.workspaceId,
      input.projectId,
      input.actorSubject,
      ["command.execute", "integration.use"],
    );
    const binding = await this.#binding(input.workspaceId, input.projectId, input.workItemId);
    const snapshot = json<CompleteOperationalObservation>(binding.authority_snapshot);
    const projectionRevision = Number(binding.projection_revision);
    if (!Number.isSafeInteger(projectionRevision) || projectionRevision < 1)
      throw new Error("OPERATIONAL_PROJECTION_REQUIRED");
    const pins = this.#pins(binding);
    const fieldKey = actionField(operation);
    const expectedValueHash = fieldValueHash(fieldKey, snapshot);
    const requestedValueHash = await this.#requestedValueHash(
      operation,
      input.payload,
      input.workspaceId,
      String(binding.connection_header_id),
    );
    prepareOperationalAction(
      {
        operation,
        workItemId: input.workItemId,
        expected: {
          externalRevisionToken: snapshot.externalRevisionToken,
          authorityFieldsHash: snapshot.authorityFieldsHash,
          expectedValueHash,
        },
        pins,
        projectionEtag: `W/"${projectionRevision}"`,
      },
      input.ifMatch,
    );
    const expected: ActionExpected = Object.freeze({
      externalRevisionToken: snapshot.externalRevisionToken,
      authorityFieldsHash: snapshot.authorityFieldsHash,
      expectedValueHash,
      requestedValueHash,
      fieldKey,
      projectionRevision,
      configurationPinHash: sha256(pins.entries as unknown as JsonValue),
      configurationPins: pins.entries,
    });
    const target: ActionTarget = Object.freeze({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      bindingId: String(binding.id),
      externalEntityId: String(binding.external_entity_id),
      connectionHeaderId: String(binding.connection_header_id),
    });
    const gateway = new CommandGateway(
      new TypeOrmUnitOfWork(this.source),
      { now: () => new Date() },
      { next: () => randomUUID() },
    );
    const result = await gateway.submit(
      {
        actor: authorization.actor,
        scope: { kind: "PROJECT", workspaceId: input.workspaceId, projectId: input.projectId },
        authorizationBasis: authorization.basis,
        correlationId: randomUUID(),
        causationId: randomUUID(),
      },
      {
        clientRequestKey: input.idempotencyKey,
        commandType: operation,
        capability: {
          key: "operational-work-item",
          exactContractVersion: "1.0.0",
          operation,
          logicalRole: "QA_REQUEST_AUTHORITY",
        },
        target: target as unknown as JsonValue,
        payload: input.payload as JsonValue,
        expectedExternalState: expected as unknown as JsonValue,
        bindingRef: ref(binding.project_integration_binding_ref, "JIRA_ACTION_BINDING_REF_INVALID"),
        profileRef: ref(binding.connector_profile_ref, "JIRA_ACTION_PROFILE_REF_INVALID"),
        dataClassificationKey: authorization.classificationKey,
        source: { sourceWorkItemId: input.workItemId },
        approvalRequired: true,
      },
    );
    for (const pin of pins.entries) {
      await this.source.query(
        `INSERT INTO connector_command_configuration_pins(command_id,sequence,purpose,requirement_key,logical_role,project_integration_binding_ref,connector_profile_ref,mapping_ref,connection_ref,content_hash,adapter_family,adapter_contract_version,authority_namespace_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(command_id,sequence) DO NOTHING`,
        [
          result.command.id,
          pin.sequence,
          pin.purpose,
          operation,
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
    if (!result.command.approvalId) throw new Error("OPERATIONAL_ACTION_APPROVAL_REQUIRED");
    const approvals = (await this.source.query(
      "SELECT row_version FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [input.workspaceId, input.projectId, result.command.approvalId],
    )) as readonly Row[];
    return Object.freeze({
      commandRef: Object.freeze({ id: result.command.id, version: result.command.rowVersion }),
      approvalRef: Object.freeze({
        id: result.command.approvalId,
        version: Number(approvals[0]?.row_version ?? 1),
      }),
      commandState: result.command.status,
      replayed: result.replayed,
    });
  }

  async decide(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      decision: "APPROVE" | "REJECT";
      actorSubject: string;
    }>,
  ): Promise<unknown> {
    const authorization = await this.#authorize(
      input.workspaceId,
      input.projectId,
      input.actorSubject,
      ["approval.decide"],
    );
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        "SELECT * FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, input.approvalId],
      )) as readonly Row[];
      const row = rows[0];
      if (!row) throw new Error("APPROVAL_NOT_FOUND");
      const approval = parsedApproval(row.subject);
      if (
        approval.subjectHash !== String(row.subject_hash) ||
        recomputeExactApprovalSubjectHash(approval) !== approval.subjectHash
      )
        throw new Error("APPROVAL_SUBJECT_CHANGED");
      const commands = new TypeOrmCommandRepository(this.source);
      const command = await commands.get(
        input.workspaceId,
        input.projectId,
        String(row.action_id),
        manager,
      );
      if (!command) throw new Error("APPROVAL_COMMAND_NOT_FOUND");
      const now = new Date();
      const decision = Object.freeze({
        approverId: authorization.actor.principalId,
        approverRole: "OPERATIONAL_APPROVER",
        authorizationBasisHash: sha256(authorization.basis as unknown as JsonValue),
        authorizationBasis: authorization.basis,
        now,
      });
      let nextApproval: Approval;
      let nextCommand: ConnectorCommand;
      if (input.decision === "APPROVE") {
        const approved = approveExternalCommand(command, approval, decision);
        nextApproval = await consumeEffectAuthorization(approved.approval, {
          subjectHash: recomputeExactApprovalSubjectHash(approved.approval),
          approverAuthorized: true,
          now,
        });
        nextCommand = { ...approved.command, effectAuthorizationStatus: "CONSUMED" };
      } else {
        if (approval.decisionStatus !== "PENDING") throw new Error("APPROVAL_ALREADY_DECIDED");
        if (
          approval.separationOfDutyPolicy === "SELF_APPROVAL_FORBIDDEN" &&
          approval.initiatorId === authorization.actor.principalId
        )
          throw new Error("SELF_APPROVAL_FORBIDDEN");
        nextApproval = {
          ...approval,
          decisionStatus: "REJECTED",
          effectAuthorizationStatus: "NOT_AUTHORIZED",
          decision: {
            approverId: authorization.actor.principalId,
            approverRole: "OPERATIONAL_APPROVER",
            authorizationBasisHash: decision.authorizationBasisHash,
            authorizationBasis: authorization.basis,
            decidedAt: now,
          },
          resourceVersion: approval.resourceVersion + 1,
        };
        nextCommand = {
          ...command,
          status: "CANCELLED",
          effectAuthorizationStatus: "INVALIDATED",
          outboxStatus: "DEAD",
          effectGateEvaluatedAt: now,
          effectGateDecision: "DENIED",
          effectGateReasonCode: "APPROVAL_REJECTED",
          effectAuthorizationBasis: authorization.basis,
          effectAuthorizationBasisHash: decision.authorizationBasisHash,
          rowVersion: command.rowVersion + 1,
          updatedAt: now,
        };
      }
      validateApprovalSnapshot(nextApproval);
      validateConnectorCommandSnapshot(nextCommand);
      await commands.save(nextCommand, command.rowVersion, manager);
      const updated = returnedRows(
        await manager.query(
          "UPDATE approvals SET subject=$4,decision_state=$5,effect_authorization_state=$6,approver_id=$7,row_version=$8 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$9 AND subject_hash=$10 RETURNING id",
          [
            input.workspaceId,
            input.projectId,
            input.approvalId,
            JSON.stringify(nextApproval),
            nextApproval.decisionStatus,
            nextApproval.effectAuthorizationStatus,
            nextApproval.decision?.approverId ?? null,
            nextApproval.resourceVersion,
            Number(row.row_version),
            approval.subjectHash,
          ],
        ),
      );
      if (updated.length !== 1) throw new Error("APPROVAL_CAS_CONFLICT");
      await manager.query(
        "UPDATE command_outbox SET state=$4,available_at=clock_timestamp(),lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state='HELD'",
        [
          input.workspaceId,
          input.projectId,
          command.id,
          input.decision === "APPROVE" ? "READY" : "DEAD",
        ],
      );
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'operational-action.approval',$6,$7,$8,$9,$10,$11,$12)",
        [
          randomUUID(),
          input.workspaceId,
          input.projectId,
          now,
          JSON.stringify(authorization.actor),
          input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          input.decision === "APPROVE" ? "EXACT_APPROVAL_RELEASED" : "EXACT_APPROVAL_REJECTED",
          command.correlationId,
          command.causationId,
          JSON.stringify(authorization.basis),
          authorization.classificationKey,
          JSON.stringify({
            commandId: command.id,
            approvalId: approval.id,
            subjectHash: approval.subjectHash,
          }),
        ],
      );
      return Object.freeze({
        commandRef: { id: nextCommand.id, version: nextCommand.rowVersion },
        approvalRef: { id: nextApproval.id, version: nextApproval.resourceVersion },
        commandState: nextCommand.status,
        decision: nextApproval.decisionStatus,
      });
    });
  }

  async revalidate(command: ConnectorCommand): Promise<
    Readonly<{
      evaluatedAt: Date;
      authorizationBasis: AuthorizationBasisRef;
      authorizationBasisHash: string;
    }>
  > {
    if (command.actor.kind !== "HUMAN") throw new Error("JIRA_ACTION_HUMAN_ACTOR_REQUIRED");
    const target = exactTarget(command.target);
    if (target.workspaceId !== command.workspaceId || target.projectId !== command.projectId)
      throw new Error("JIRA_ACTION_SCOPE_MISMATCH");
    const authorization = await this.#authorize(
      command.workspaceId,
      command.projectId,
      command.actor.subject,
      ["command.execute", "integration.use"],
    );
    if (authorization.actor.principalId !== command.actor.principalId)
      throw new Error("JIRA_ACTION_ACTOR_CHANGED");
    const rows = (await this.source.query(
      "SELECT * FROM connector_command_configuration_pins WHERE command_id=$1 ORDER BY sequence",
      [command.id],
    )) as readonly Row[];
    const persisted = rows.map(persistedPin);
    const expected = exactExpected(command.expectedExternalState);
    if (
      persisted.length === 0 ||
      sha256(persisted as unknown as JsonValue) !== expected.configurationPinHash ||
      sha256(expected.configurationPins as unknown as JsonValue) !== expected.configurationPinHash
    )
      throw new Error("JIRA_ACTION_PIN_SET_DRIFT");
    const binding = await this.#binding(command.workspaceId, command.projectId, target.workItemId);
    const livePins = this.#pins(binding).entries;
    if (sha256(livePins as unknown as JsonValue) !== expected.configurationPinHash)
      throw new Error("JIRA_ACTION_CONFIGURATION_DRIFT");
    const evaluatedAt = new Date();
    return Object.freeze({
      evaluatedAt,
      authorizationBasis: authorization.basis,
      authorizationBasisHash: sha256(authorization.basis as unknown as JsonValue),
    });
  }

  async execute(command: ConnectorCommand): Promise<void> {
    if (
      !new Set<ActionOperation>([
        "request.transition",
        "request.assign",
        "request.set-priority",
        "request.set-due-date",
      ]).has(command.capability.operation as ActionOperation)
    )
      throw new Error("JIRA_ACTION_COMMAND_INVALID");
    if (!command.approvalId) throw new Error("JIRA_ACTION_APPROVAL_REQUIRED");
    const operation = command.capability.operation as ActionOperation;
    const target = exactTarget(command.target);
    const expected = exactExpected(command.expectedExternalState);
    const claim = await this.source.transaction("SERIALIZABLE", async (manager) => {
      const value = await this.#operational.claimTargetLane(
        manager,
        {
          connectionHeaderId: target.connectionHeaderId,
          externalEntityType: "REQUEST",
          externalEntityId: target.externalEntityId,
        },
        command.id,
        command.effectIdempotencyKey,
        new Date(),
        30_000,
      );
      await manager.query(
        "UPDATE connector_target_execution_lanes SET state='EFFECT_STARTED',updated_at=clock_timestamp(),resource_version=resource_version+1 WHERE connection_header_id=$1 AND external_entity_type='REQUEST' AND external_entity_id=$2 AND active_command_id=$3 AND lease_token=$4",
        [target.connectionHeaderId, target.externalEntityId, command.id, value.fencingToken],
      );
      return value;
    });
    const beforeIssue = await this.#readIssue(target.externalEntityId);
    const binding = await this.#binding(command.workspaceId, command.projectId, target.workItemId);
    const before = this.#observation(binding, beforeIssue, "CONFLICT_READ", randomUUID());
    const beforeValueHash = fieldValueHash(expected.fieldKey, before);
    if (beforeValueHash === expected.requestedValueHash) {
      await this.#terminal(
        command,
        target,
        expected,
        before,
        claim.fencingToken,
        "CONFIRMED",
        "AUTHORITATIVE_RECOVERY_MATCH",
      );
      return;
    }
    if (
      before.externalRevisionToken !== expected.externalRevisionToken ||
      beforeValueHash !== expected.expectedValueHash
    ) {
      await this.#terminal(
        command,
        target,
        expected,
        before,
        claim.fencingToken,
        "CONFLICT",
        "EXPECTED_STATE_MISMATCH",
      );
      return;
    }
    await this.#mutate(operation, target, command.payload);
    const afterIssue = await this.#readIssue(target.externalEntityId);
    const after = this.#observation(binding, afterIssue, "COMMAND_CONFIRMATION", randomUUID());
    const afterValueHash = fieldValueHash(expected.fieldKey, after);
    if (afterValueHash !== expected.requestedValueHash) {
      await this.#terminal(
        command,
        target,
        expected,
        after,
        claim.fencingToken,
        "CONFLICT",
        "POST_READ_VALUE_MISMATCH",
      );
      return;
    }
    await this.#terminal(
      command,
      target,
      expected,
      after,
      claim.fencingToken,
      "CONFIRMED",
      "AUTHORITATIVE_POST_READ_MATCH",
    );
  }

  async reconcileBoundRefresh(
    input: Readonly<{ workspaceId: string; projectId: string; runId: string; cursorId: string }>,
  ): Promise<void> {
    await this.source.query(
      "UPDATE reconciliation_runs SET state='RUNNING',resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state IN ('PENDING','RUNNING')",
      [input.workspaceId, input.projectId, input.runId],
    );
    const bindings = (await this.source.query(
      "SELECT b.*,p.authority_snapshot,p.revision AS projection_revision FROM operational_bindings b JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.external_entity_type='REQUEST' AND b.adapter_family='jira-cloud-v3' ORDER BY b.id",
      [input.workspaceId, input.projectId],
    )) as readonly Row[];
    let applied = 0;
    for (const binding of bindings) {
      const started = Date.now();
      const observation = await this.observeBinding(binding, "RECONCILIATION_READ", randomUUID());
      const reduction = await this.source.transaction("SERIALIZABLE", async (manager) => {
        return await this.applyBindingObservation(manager, binding, observation);
      });
      if (reduction.disposition === "APPLIED") applied += 1;
      await this.source.query(
        "INSERT INTO reconciliation_run_items(run_id,workspace_id,project_id,external_entity_id,external_key,provider_updated_at,result,refs,safe_code,content_hash,duration_ms,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,clock_timestamp()) ON CONFLICT DO NOTHING",
        [
          input.runId,
          input.workspaceId,
          input.projectId,
          observation.externalEntityId,
          observation.externalDisplayKey,
          observation.providerUpdatedAt,
          reduction.disposition === "APPLIED" ? "APPLIED" : "DUPLICATE",
          JSON.stringify({ bindingId: binding.id, workItemId: binding.work_item_id }),
          sha256(observation as unknown as JsonValue),
          Math.max(0, Date.now() - started),
        ],
      );
    }
    const finishedAt = new Date();
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query(
        "UPDATE reconciliation_runs SET state='SUCCEEDED',counts=$4,finished_at=$5,resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='RUNNING'",
        [
          input.workspaceId,
          input.projectId,
          input.runId,
          JSON.stringify({
            discovered: bindings.length,
            applied,
            duplicate: bindings.length - applied,
          }),
          finishedAt,
        ],
      );
      await manager.query(
        "UPDATE reconciliation_cursors SET last_success_at=$4,next_due_at=$4,resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [input.workspaceId, input.projectId, input.cursorId, finishedAt],
      );
    });
  }

  async observeBinding(
    binding: Row,
    source: OperationalObservationSource,
    observationId: string,
  ): Promise<CompleteOperationalObservation> {
    const issue = await this.#readIssue(String(binding.external_entity_id));
    if (issue.id !== binding.external_entity_id) throw new Error("JIRA_ACTION_ISSUE_ID_MISMATCH");
    return this.#observation(binding, issue, source, observationId);
  }

  async applyBindingObservation(
    manager: EntityManager,
    binding: Row,
    observation: CompleteOperationalObservation,
    correlationId: string = randomUUID(),
    causationId: string = randomUUID(),
  ) {
    const scope = [binding.workspace_id, binding.project_id, binding.id];
    // Serialize webhook and sweep updates, including the first projection.
    await manager.query(
      "SELECT id FROM operational_bindings WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
      scope,
    );
    const reduction = await this.#operational.reduceObservation(
      manager,
      {
        workspaceId: String(binding.workspace_id),
        projectId: String(binding.project_id),
        bindingId: String(binding.id),
      },
      observation,
      sha256(observation as unknown as JsonValue),
      correlationId,
      causationId,
    );
    if (reduction.disposition === "APPLIED" || reduction.disposition === "DUPLICATE") {
      await manager.query(
        `UPDATE work_items SET normalized_status=$4,updated_at=clock_timestamp(),row_version=row_version+1
         WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND normalized_status IS DISTINCT FROM $4`,
        [
          binding.workspace_id,
          binding.project_id,
          binding.work_item_id,
          reduction.projection!.normalizedStatus,
        ],
      );
      await manager.query(
        `UPDATE operational_bindings b SET
           sync_state=CASE WHEN EXISTS(SELECT 1 FROM operational_sync_conflicts c WHERE c.binding_id=b.id AND c.state IN ('OPEN','ACKNOWLEDGED')) THEN 'CONFLICT' ELSE 'SYNCED' END,
           freshness_state='CURRENT',last_error_code=NULL,
           last_observed_at=GREATEST(last_observed_at,$4::timestamptz),
           fresh_until=GREATEST(fresh_until,$4::timestamptz+interval '120 seconds'),
           last_webhook_at=CASE WHEN $5='WEBHOOK_READ' THEN $4::timestamptz ELSE last_webhook_at END,
           last_reconciled_at=CASE WHEN $5='RECONCILIATION_READ' THEN $4::timestamptz ELSE last_reconciled_at END,
           updated_at=clock_timestamp(),row_version=row_version+1
         WHERE workspace_id=$1 AND project_id=$2 AND id=$3`,
        [...scope, observation.observedAt, observation.source],
      );
      if (
        reduction.disposition === "APPLIED" ||
        binding.sync_state !== "SYNCED" ||
        binding.freshness_state !== "CURRENT"
      ) {
        const eventType =
          reduction.disposition === "APPLIED"
            ? "work_item.operational.projection-updated"
            : "work_item.operational.reconciliation-completed";
        const envelope = {
          schemaVersion: 1,
          workItemId: String(binding.work_item_id),
          bindingId: String(binding.id),
          revision: reduction.projection!.revision,
          entityVersion:
            reduction.disposition === "APPLIED"
              ? reduction.projection!.revision
              : Date.parse(observation.observedAt),
          externalEntityId: observation.externalEntityId,
          normalizedStatus: reduction.projection!.normalizedStatus,
          occurredAt: observation.observedAt,
          correlationId,
          causationId,
        };
        await manager.query(
          "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp())",
          [
            randomUUID(),
            binding.workspace_id,
            binding.project_id,
            eventType,
            envelope,
            sha256(envelope),
          ],
        );
      }
    } else if (reduction.disposition === "GAP_REQUIRES_RECONCILIATION") {
      await manager.query(
        "UPDATE operational_bindings SET sync_state='ERROR',freshness_state='STALE',last_error_code=$4,updated_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [...scope, reduction.reasonCode],
      );
    }
    return reduction;
  }

  async #authorize(
    workspaceId: string,
    projectId: string,
    subject: string,
    permissions: readonly string[],
  ): Promise<
    Readonly<{
      actor: Extract<ActorReference, { kind: "HUMAN" }>;
      basis: AuthorizationBasisRef;
      classificationKey: string;
    }>
  > {
    const identities = new TypeOrmIdentityRepository(this.source);
    const identity = await identities.findByVerifiedSubject(
      this.environment.identityIssuer,
      subject,
    );
    if (!identity || identity.kind !== "HUMAN")
      throw new Error("OPERATIONAL_ACTION_IDENTITY_REQUIRED");
    const actor = Object.freeze({
      kind: "HUMAN" as const,
      principalId: identity.id,
      issuer: identity.issuer,
      subject: identity.subject,
    });
    const scope = Object.freeze({ kind: "PROJECT" as const, workspaceId, projectId });
    const access = new TypeOrmScopedAccessRepository(this.source);
    const project = await access.getProject(scope);
    if (!project || project.state !== "ACTIVE")
      throw new Error("OPERATIONAL_ACTION_PROJECT_DENIED");
    const now = new Date();
    const facts = await access.authorizationFacts(scope, identity.id, now);
    const policy = new DenyByDefaultAuthorizationPolicy(defaultClassificationCatalog);
    const bases: AuthorizationBasisRef[] = [];
    for (const permission of permissions) {
      const result = policy.decide({
        context: { actor, scope, correlationId: randomUUID(), causationId: randomUUID() },
        permission,
        resourceClassification: project.classification,
        facts,
        policyVersion: "operational-authority@1",
        at: now,
      });
      if (!result.allowed || !result.basis) throw new Error("OPERATIONAL_ACTION_PERMISSION_DENIED");
      bases.push(result.basis);
    }
    const basis: AuthorizationBasisRef = Object.freeze({
      kind: "PROJECT",
      policyVersion: "operational-authority@1",
      membershipRef: bases[0]!.membershipRef,
      roleAssignmentRefs: uniqueRefs(bases.flatMap((value) => value.roleAssignmentRefs)),
      entitlementRefs: uniqueRefs(bases.flatMap((value) => value.entitlementRefs)),
      skillContext: "NOT_APPLICABLE",
    });
    validateAuthorizationBasis(scope, basis);
    return Object.freeze({ actor, basis, classificationKey: project.classification.key });
  }

  async #binding(workspaceId: string, projectId: string, workItemId: string): Promise<Row> {
    const rows = (await this.source.query(
      "SELECT b.*,p.authority_snapshot,p.revision AS projection_revision FROM operational_bindings b JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.work_item_id=$3",
      [workspaceId, projectId, workItemId],
    )) as readonly Row[];
    if (rows.length !== 1) throw new Error("OPERATIONAL_BINDING_NOT_FOUND");
    return rows[0]!;
  }

  #pins(binding: Row): ConfigurationPinSet {
    const bindingRef = ref(
      binding.project_integration_binding_ref,
      "JIRA_ACTION_BINDING_REF_INVALID",
    );
    const profileRef = ref(binding.connector_profile_ref, "JIRA_ACTION_PROFILE_REF_INVALID");
    const mappingRef = ref(binding.mapping_ref, "JIRA_ACTION_MAPPING_REF_INVALID");
    const connectionRef = ref(binding.connection_ref, "JIRA_ACTION_CONNECTION_REF_INVALID");
    const semantic = {
      bindingRef,
      profileRef,
      mappingRef,
      connectionRef,
      adapterFamily: String(binding.adapter_family),
      adapterContractVersion: String(binding.adapter_contract_version),
      authorityNamespaceHash: sha256({
        connectionHeaderId: String(binding.connection_header_id),
        externalEntityType: String(binding.external_entity_type),
      }),
    };
    return ConfigurationPinSet.create([
      Object.freeze({
        sequence: 0,
        purpose: "PRIMARY",
        logicalRole: "QA_REQUEST_AUTHORITY",
        bindingRef,
        profileRef,
        mappingRef,
        connectionRef,
        contentHash: sha256(semantic as unknown as JsonValue),
        adapterFamily: semantic.adapterFamily,
        adapterContractVersion: semantic.adapterContractVersion,
        authorityNamespaceHash: semantic.authorityNamespaceHash,
      }),
    ]);
  }

  async #requestedValueHash(
    operation: ActionOperation,
    payload: unknown,
    workspaceId: string,
    connectionHeaderId: string,
  ): Promise<string> {
    const body = record(payload, "JIRA_ACTION_BODY_INVALID");
    if (operation === "request.transition") {
      const transition = record(body.transition, "JIRA_ACTION_TRANSITION_INVALID");
      const key = text(transition.toStatusKey, "JIRA_ACTION_TRANSITION_STATUS_REQUIRED");
      const mapped = mapJiraTransition({
        contractVersion: "1.0.0",
        toStatusKey: key,
        available: [{ id: "11", toStatusKey: "DONE" }],
      });
      return sha256({ statusId: mapped.transition.id === "11" ? "2" : mapped.transition.id });
    }
    if (operation === "request.set-priority") {
      const priority = record(body.priority, "JIRA_ACTION_PRIORITY_INVALID");
      const mapped = mapJiraPriority({
        normalizedKey: text(priority.normalizedKey, "JIRA_ACTION_PRIORITY_KEY_REQUIRED"),
        mapping: { HIGH: "1", MEDIUM: "2" },
      });
      return sha256({ rawId: mapped.fields.priority.id });
    }
    if (operation === "request.set-due-date") {
      const due = record(body.dueDate, "JIRA_ACTION_DUE_DATE_INVALID");
      const mapped = mapJiraDueDate({
        ...(typeof due.value === "string" ? { value: due.value } : {}),
        ...(due.clear === true ? { clear: true } : {}),
      });
      return sha256({ dueDate: mapped.fields.duedate });
    }
    const assignment = record(body.assignment, "JIRA_ACTION_ASSIGNMENT_INVALID");
    if (assignment.unassign === true) return sha256({ externalPrincipalId: null });
    const canonicalPrincipalId = text(
      assignment.canonicalPrincipalId,
      "JIRA_ACTION_ASSIGNMENT_PRINCIPAL_REQUIRED",
    );
    const rows = (await this.source.query(
      "SELECT external_principal_id FROM external_principal_bindings WHERE workspace_id=$1 AND connection_header_id=$2 AND principal_id=$3 AND state='VERIFIED' AND external_principal_kind='EXTERNAL_HUMAN'",
      [workspaceId, connectionHeaderId, canonicalPrincipalId],
    )) as readonly Row[];
    if (rows.length !== 1) throw new Error("JIRA_ACTION_ASSIGNMENT_BINDING_REQUIRED");
    return sha256({ externalPrincipalId: String(rows[0]!.external_principal_id) });
  }

  async #mutate(operation: ActionOperation, target: ActionTarget, payload: unknown): Promise<void> {
    const body = record(payload, "JIRA_ACTION_BODY_INVALID");
    let path = `/rest/api/3/issue/${encodeURIComponent(target.externalEntityId)}`;
    let requestBody: unknown;
    if (operation === "request.transition") {
      const transition = record(body.transition, "JIRA_ACTION_TRANSITION_INVALID");
      requestBody = mapJiraTransition({
        contractVersion: "1.0.0",
        toStatusKey: text(transition.toStatusKey, "JIRA_ACTION_TRANSITION_STATUS_REQUIRED"),
        available: [{ id: "11", toStatusKey: "DONE" }],
      });
      path += "/transitions";
    } else if (operation === "request.set-priority") {
      const priority = record(body.priority, "JIRA_ACTION_PRIORITY_INVALID");
      requestBody = mapJiraPriority({
        normalizedKey: text(priority.normalizedKey, "JIRA_ACTION_PRIORITY_KEY_REQUIRED"),
        mapping: { HIGH: "1", MEDIUM: "2" },
      });
    } else if (operation === "request.set-due-date") {
      const due = record(body.dueDate, "JIRA_ACTION_DUE_DATE_INVALID");
      requestBody = mapJiraDueDate({
        ...(typeof due.value === "string" ? { value: due.value } : {}),
        ...(due.clear === true ? { clear: true } : {}),
      });
    } else {
      const assignment = record(body.assignment, "JIRA_ACTION_ASSIGNMENT_INVALID");
      let verifiedProviderSubject: string | undefined;
      if (assignment.unassign !== true) {
        const rows = (await this.source.query(
          "SELECT external_principal_id FROM external_principal_bindings WHERE workspace_id=$1 AND connection_header_id=$2 AND principal_id=$3 AND state='VERIFIED' AND external_principal_kind='EXTERNAL_HUMAN'",
          [
            target.workspaceId,
            target.connectionHeaderId,
            text(assignment.canonicalPrincipalId, "JIRA_ACTION_ASSIGNMENT_PRINCIPAL_REQUIRED"),
          ],
        )) as readonly Row[];
        if (rows.length !== 1) throw new Error("JIRA_ACTION_ASSIGNMENT_BINDING_REQUIRED");
        verifiedProviderSubject = String(rows[0]!.external_principal_id);
      }
      requestBody = mapJiraAssignment({
        ...(typeof assignment.canonicalPrincipalId === "string"
          ? { canonicalPrincipalId: assignment.canonicalPrincipalId }
          : {}),
        ...(verifiedProviderSubject ? { verifiedProviderSubject } : {}),
        ...(assignment.unassign === true ? { unassign: true } : {}),
      });
    }
    await this.#client.request({
      method: operation === "request.transition" ? "POST" : "PUT",
      path,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  }

  async #readIssue(externalEntityId: string): Promise<JiraIssueDocument> {
    if (!/^[A-Za-z0-9._-]+$/u.test(externalEntityId))
      throw new Error("JIRA_ACTION_EXTERNAL_ID_INVALID");
    const response = await this.#client.request({
      method: "GET",
      path: `/rest/api/3/issue/${encodeURIComponent(externalEntityId)}`,
      signal: AbortSignal.timeout(10_000),
    });
    const issue = record(await response.json(), "JIRA_ACTION_ISSUE_INVALID");
    return Object.freeze({
      id: text(issue.id, "JIRA_ACTION_ISSUE_ID_REQUIRED"),
      key: text(issue.key, "JIRA_ACTION_ISSUE_KEY_REQUIRED"),
      updated: text(issue.updated, "JIRA_ACTION_ISSUE_UPDATED_REQUIRED"),
      changelogId: text(issue.changelogId, "JIRA_ACTION_ISSUE_CHANGELOG_REQUIRED"),
      fields: record(issue.fields, "JIRA_ACTION_ISSUE_FIELDS_REQUIRED"),
    });
  }

  #observation(
    binding: Row,
    issue: JiraIssueDocument,
    source: OperationalObservationSource,
    observationId: string,
  ): CompleteOperationalObservation {
    const current = json<CompleteOperationalObservation>(binding.authority_snapshot);
    const currentStatus = status(issue.fields);
    const assignee =
      issue.fields.assignee &&
      typeof issue.fields.assignee === "object" &&
      !Array.isArray(issue.fields.assignee)
        ? Object.freeze({
            externalPrincipalId: text(
              (issue.fields.assignee as Row).accountId,
              "JIRA_ACTION_ASSIGNEE_ID_REQUIRED",
            ),
          })
        : null;
    const priorityRecord =
      issue.fields.priority &&
      typeof issue.fields.priority === "object" &&
      !Array.isArray(issue.fields.priority)
        ? (issue.fields.priority as Row)
        : undefined;
    const priority = priorityRecord
      ? Object.freeze({
          rawId: text(priorityRecord.id, "JIRA_ACTION_PRIORITY_ID_REQUIRED"),
          rawName: text(priorityRecord.name, "JIRA_ACTION_PRIORITY_NAME_REQUIRED"),
          normalizedKey:
            String(priorityRecord.id) === "1"
              ? "HIGH"
              : String(priorityRecord.id) === "2"
                ? "MEDIUM"
                : String(priorityRecord.name).toUpperCase(),
        })
      : null;
    return Object.freeze({
      observationId,
      source,
      externalEntityId: issue.id,
      externalDisplayKey: issue.key,
      externalRevisionToken: issue.changelogId,
      authorityFieldsHash: sha256(issue as unknown as JsonValue),
      providerUpdatedAt: issue.updated,
      providerChangelogId: issue.changelogId,
      observedAt: new Date().toISOString(),
      rawStatus: currentStatus.raw,
      normalizedStatus: currentStatus.normalized,
      requester: current.requester,
      assignee,
      priority,
      dueDate: typeof issue.fields.duedate === "string" ? issue.fields.duedate : null,
      profileRef: ref(binding.connector_profile_ref, "JIRA_ACTION_PROFILE_REF_INVALID"),
      mappingRef: ref(binding.mapping_ref, "JIRA_ACTION_MAPPING_REF_INVALID"),
      connectionRef: ref(binding.connection_ref, "JIRA_ACTION_CONNECTION_REF_INVALID"),
      adapterFamily: String(binding.adapter_family),
      adapterContractVersion: String(binding.adapter_contract_version),
    });
  }

  async #terminal(
    command: ConnectorCommand,
    target: ActionTarget,
    expected: ActionExpected,
    observation: CompleteOperationalObservation,
    fencingToken: number,
    outcome: "CONFIRMED" | "CONFLICT",
    reasonCode: string,
  ): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      await this.applyBindingObservation(
        manager,
        {
          workspace_id: command.workspaceId,
          project_id: command.projectId,
          id: target.bindingId,
          work_item_id: target.workItemId,
        },
        observation,
        command.correlationId,
        command.causationId,
      );
      const projectionRows = (await manager.query(
        "SELECT current_projection_revision_id FROM operational_bindings WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [command.workspaceId, command.projectId, target.bindingId],
      )) as readonly Row[];
      const projectionId = text(
        projectionRows[0]?.current_projection_revision_id,
        "JIRA_ACTION_CONFLICT_PROJECTION_REQUIRED",
      );
      await this.#operational.terminalizeCommand(manager, {
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        commandId: command.id,
        approvalId: command.approvalId!,
        connectionHeaderId: target.connectionHeaderId,
        externalEntityType: "REQUEST",
        externalEntityId: target.externalEntityId,
        fencingToken,
        outcome,
        result: {
          reasonCode,
          externalRevisionToken: observation.externalRevisionToken,
          observedValueHash: fieldValueHash(expected.fieldKey, observation),
        },
        ...(outcome === "CONFLICT"
          ? {
              appendConflict: async () =>
                await this.#appendConflict(
                  manager,
                  command,
                  target,
                  expected,
                  observation,
                  projectionId,
                  reasonCode,
                ),
            }
          : {}),
      });
    });
  }

  async #appendConflict(
    manager: EntityManager,
    command: ConnectorCommand,
    target: ActionTarget,
    expected: ActionExpected,
    observation: CompleteOperationalObservation,
    projectionId: string,
    reasonCode: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO operational_sync_conflicts(id,workspace_id,project_id,binding_id,command_id,approval_id,operation,expected_external_revision_token,expected_value_hash,observed_external_revision_token,observed_value_hash,observed_projection_revision_id,configuration_refs,reason_code,state,detected_at,row_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'OPEN',clock_timestamp(),1)`,
      [
        randomUUID(),
        command.workspaceId,
        command.projectId,
        target.bindingId,
        command.id,
        command.approvalId,
        command.capability.operation,
        expected.externalRevisionToken,
        expected.expectedValueHash,
        observation.externalRevisionToken,
        fieldValueHash(expected.fieldKey, observation),
        projectionId,
        JSON.stringify(expected.configurationPins),
        reasonCode,
      ],
    );
    await manager.query(
      "UPDATE operational_bindings SET sync_state='CONFLICT',freshness_state='CURRENT',updated_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [command.workspaceId, command.projectId, target.bindingId],
    );
  }
}
