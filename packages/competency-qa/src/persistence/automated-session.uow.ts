import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import type { PlannedAutomatedSession } from "../application/plan-automated-session.ts";
import type { QaProjectEffectGuardPort } from "../application/session-start-guards.ts";
import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  QaDomainError,
} from "../domain/primitives.ts";

export interface AutomatedSessionPersistenceContext {
  readonly authorizationBasis: QaAuthorizationBasis;
  readonly authorizationBasisHash: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export interface LegacyAutomatedSessionReadyTrustedRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly eventType: "qa.automated-session.ready";
  readonly createdAt: string;
  readonly envelope: unknown;
}

export interface LegacyAutomatedSessionReadyPayload {
  readonly sessionId: string;
  readonly workItemId: string;
  readonly mode: "AUTOMATED";
  readonly state: "READY";
  readonly suiteBindingRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly targetSnapshotHash: string;
  readonly scopeSnapshotHash: string;
  readonly configurationPinSetHash: string;
}

const legacyReadyPayloadKeys = Object.freeze([
  "configurationPinSetHash",
  "mode",
  "scopeSnapshotHash",
  "sessionId",
  "state",
  "suiteBindingRef",
  "targetSnapshotHash",
  "workItemId",
] as const);
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

/**
 * Bounded payload-only compatibility path for trusted pre-006 outbox rows.
 * It validates row scope/type and raw payload, but never constructs or
 * republishes a canonical envelope from incomplete historical metadata.
 */
export async function replayLegacyAutomatedSessionReadyTrustedRow<T>(
  row: LegacyAutomatedSessionReadyTrustedRow,
  consumePayloadOnly: (
    input: Readonly<{
      transportRecordId: string;
      trustedWorkspaceId: string;
      trustedProjectId: string;
      eventType: "qa.automated-session.ready";
      createdAt: string;
      payload: LegacyAutomatedSessionReadyPayload;
      validationKind: "LEGACY_PAYLOAD_ONLY";
    }>,
  ) => Promise<T>,
): Promise<T> {
  const payload = row.envelope as Partial<LegacyAutomatedSessionReadyPayload> &
    Readonly<Record<string, unknown>>;
  if (
    row.eventType !== "qa.automated-session.ready" ||
    !row.id ||
    !row.workspaceId ||
    !row.projectId ||
    Number.isNaN(Date.parse(row.createdAt)) ||
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join("\n") !== [...legacyReadyPayloadKeys].sort().join("\n") ||
    typeof payload.sessionId !== "string" ||
    typeof payload.workItemId !== "string" ||
    payload.mode !== "AUTOMATED" ||
    payload.state !== "READY" ||
    payload.suiteBindingRef === null ||
    typeof payload.suiteBindingRef !== "object" ||
    typeof payload.suiteBindingRef.id !== "string" ||
    !Number.isInteger(payload.suiteBindingRef.version) ||
    typeof payload.suiteBindingRef.contentHash !== "string" ||
    !hashPattern.test(payload.suiteBindingRef.contentHash) ||
    typeof payload.targetSnapshotHash !== "string" ||
    !hashPattern.test(payload.targetSnapshotHash) ||
    typeof payload.scopeSnapshotHash !== "string" ||
    !hashPattern.test(payload.scopeSnapshotHash) ||
    typeof payload.configurationPinSetHash !== "string" ||
    !hashPattern.test(payload.configurationPinSetHash)
  )
    throw new QaDomainError("QA_AUTOMATED_SESSION_READY_LEGACY_ROW_INVALID");
  return consumePayloadOnly(
    Object.freeze({
      transportRecordId: row.id,
      trustedWorkspaceId: row.workspaceId,
      trustedProjectId: row.projectId,
      eventType: row.eventType,
      createdAt: row.createdAt,
      payload: Object.freeze(payload as LegacyAutomatedSessionReadyPayload),
      validationKind: "LEGACY_PAYLOAD_ONLY",
    }),
  );
}

function affected(value: unknown): number {
  const raw = value as readonly unknown[];
  return Array.isArray(raw[0]) ? (raw[0] as readonly unknown[]).length : raw.length;
}

export class TypeOrmAutomatedSessionUnitOfWork {
  constructor(
    private readonly source: DataSource,
    private readonly effectGuard?: QaProjectEffectGuardPort,
  ) {}

  async persist(
    planned: PlannedAutomatedSession,
    context: AutomatedSessionPersistenceContext,
  ): Promise<PlannedAutomatedSession> {
    if (
      planned.session.createdBy.kind !== "HUMAN" ||
      planned.configurationPins.length !== 3 ||
      planned.targetSnapshot.configurationPinSetHash !== planned.session.configurationPinSetHash ||
      planned.scopeSnapshot.contentHash !== planned.session.scopeSnapshotHash ||
      planned.planItem.id !== planned.session.planItemId ||
      context.authorizationBasisHash !==
        qaAggregateSnapshotHash(context.authorizationBasis as never)
    ) {
      throw new QaDomainError("QA_AUTOMATED_SESSION_PERSISTENCE_INPUT_INVALID");
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const mode = (await manager.query(
        "SELECT current_operational_state,current_capability_mode FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR SHARE",
        [planned.session.workspaceId, planned.session.projectId],
      )) as { current_operational_state: string; current_capability_mode: string }[];
      if (
        mode[0]?.current_operational_state !== undefined &&
        mode[0].current_operational_state !== "ACTIVE"
      )
        throw new QaDomainError("PROJECT_SUSPENDED");
      if (mode[0] && mode[0].current_capability_mode !== "FULL_QA")
        throw new QaDomainError("AUTOMATION_REQUIRES_FULL_QA");
      await this.effectGuard?.assertEffectsAllowed({
        workspaceId: planned.session.workspaceId,
        projectId: planned.session.projectId,
      });
      await manager.query("SELECT set_config('awp.qa_structure_mutation','allowed',true)");
      await this.#insertSession(manager, planned);
      await this.#insertPlanItem(manager, planned);
      for (const pin of planned.configurationPins) await this.#insertPin(manager, planned, pin);
      await this.#appendFacts(manager, planned, context);
      return planned;
    });
  }

  async #insertSession(manager: EntityManager, planned: PlannedAutomatedSession): Promise<void> {
    const session = planned.session;
    const inserted: unknown = await manager.query(
      `
INSERT INTO qa_test_sessions(
  session_id,workspace_id,project_id,work_item_id,ordinal,parent_session_id,plan_version_id,requirement_id,
  requirement_key,mode,state,owner_id,required_capabilities,target_snapshot,target_hash,scope_snapshot,scope_hash,
  structure_revision,structure_hash,ready_against_structure_hash,resource_version,content,created_by,created_at,
  ready_at,contract_schema_version,automation_suite_binding_id,automation_suite_binding_version,
  automation_suite_binding_content_hash,automation_configuration_pin_set_hash,automation_parameter_set_hash,
  automation_replacement_reason
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,'AUTOMATED','READY',$10,$11,$12,$13,$14,$15,1,$16,$16,1,$17,$18,$19,$19,2,$20,$21,$22,$23,$24,$25
) RETURNING session_id`,
      [
        session.id,
        session.workspaceId,
        session.projectId,
        session.workItemId,
        session.ordinal,
        session.parentSessionId ?? null,
        session.planRevisionRef.id,
        session.requirementRef.id,
        session.requirementRef.requirementKey,
        session.ownerId,
        JSON.stringify(session.requiredCapabilities),
        JSON.stringify(planned.targetSnapshot),
        session.targetSnapshotHash,
        JSON.stringify(planned.scopeSnapshot),
        session.scopeSnapshotHash,
        session.structureHash,
        JSON.stringify(session),
        JSON.stringify(session.createdBy),
        session.createdAt,
        session.suiteBindingRef.id,
        session.suiteBindingRef.version,
        session.suiteBindingRef.contentHash,
        session.configurationPinSetHash,
        session.parameterSetHash,
        session.replacement?.reason ?? null,
      ],
    );
    if (affected(inserted) !== 1) throw new QaDomainError("QA_AUTOMATED_SESSION_INSERT_FAILED");
  }

  async #insertPlanItem(manager: EntityManager, planned: PlannedAutomatedSession): Promise<void> {
    const item = planned.planItem;
    const inserted: unknown = await manager.query(
      `
INSERT INTO qa_plan_items(
  plan_item_id,workspace_id,project_id,work_item_id,session_id,ordinal,state,mode,title,instructions,
  expected_outcome,definition_ref,definition_hash,content_hash,content,resource_version,created_by,
  created_at,updated_at,contract_schema_version
) VALUES($1,$2,$3,$4,$5,1,'PLANNED','AUTOMATED',$6,NULL,$7,$8,$9,$10,$11,1,$12,$13,$13,2)
RETURNING plan_item_id`,
      [
        item.id,
        item.workspaceId,
        item.projectId,
        item.workItemId,
        item.sessionId,
        `Automated Suite ${planned.targetSnapshot.suite.suiteKey}`,
        `Machine result for ${planned.targetSnapshot.suite.suiteKey}`,
        JSON.stringify(item.suiteBindingRef),
        item.suiteBindingRef.contentHash,
        item.contentHash,
        JSON.stringify(item),
        JSON.stringify(item.createdBy),
        item.createdAt,
      ],
    );
    if (affected(inserted) !== 1) throw new QaDomainError("QA_AUTOMATED_PLAN_ITEM_INSERT_FAILED");
  }

  async #insertPin(
    manager: EntityManager,
    planned: PlannedAutomatedSession,
    pin: PlannedAutomatedSession["configurationPins"][number],
  ): Promise<void> {
    const inserted: unknown = await manager.query(
      `
INSERT INTO qa_automation_session_configuration_pins(
  pin_id,workspace_id,project_id,work_item_id,session_id,ordinal,logical_role,capability_key,
  exact_contract_version,operation_set_hash,project_integration_binding_id,project_integration_binding_version,
  project_integration_binding_content_hash,profile_id,profile_version,profile_content_hash,connection_id,
  connection_version,connection_content_hash,mapping_ref,external_scope_hash,validation_report_id,
  validation_report_content_hash,pin_content_hash,created_at
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULL,$20,$21,$22,$23,$24)
RETURNING pin_id`,
      [
        `${planned.session.id}:pin:${pin.ordinal}`,
        planned.session.workspaceId,
        planned.session.projectId,
        planned.session.workItemId,
        planned.session.id,
        pin.ordinal,
        pin.logicalRole,
        pin.capabilityKey,
        pin.exactContractVersion,
        pin.operationSetHash,
        pin.projectIntegrationBindingRef.id,
        pin.projectIntegrationBindingRef.version,
        pin.projectIntegrationBindingRef.contentHash,
        pin.profileRef.id,
        pin.profileRef.version,
        pin.profileRef.contentHash,
        pin.connectionRef.id,
        pin.connectionRef.version,
        pin.connectionRef.contentHash,
        pin.externalScopeHash,
        pin.validationReportRef.id,
        pin.validationReportRef.contentHash,
        qaAggregateSnapshotHash(pin as never),
        planned.session.createdAt,
      ],
    );
    if (affected(inserted) !== 1)
      throw new QaDomainError("QA_AUTOMATED_CONFIGURATION_PIN_INSERT_FAILED");
  }

  async #appendFacts(
    manager: EntityManager,
    planned: PlannedAutomatedSession,
    context: AutomatedSessionPersistenceContext,
  ): Promise<void> {
    const session = planned.session;
    const payload = Object.freeze({
      sessionId: session.id,
      workItemId: session.workItemId,
      mode: session.mode,
      state: session.state,
      suiteBindingRef: session.suiteBindingRef,
      targetSnapshotHash: session.targetSnapshotHash,
      scopeSnapshotHash: session.scopeSnapshotHash,
      configurationPinSetHash: session.configurationPinSetHash,
    });
    const eventId = randomUUID();
    const envelope = Object.freeze({
      envelopeVersion: 1,
      eventId,
      eventType: "qa.automated-session.ready",
      occurredAt: session.createdAt,
      recordedAt: session.createdAt,
      producer: "competency-qa",
      producerVersion: "1.3.0",
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      entityType: "qa-test-session",
      entityId: session.id,
      entityVersion: 1,
      correlationId: context.correlationId,
      causationId: context.causationId,
      actor: session.createdBy,
      dataClassificationKey: "INTERNAL",
      payloadVersion: 1,
      payloadSchemaRef: Object.freeze({
        id: "urn:awp:schemas:qa:event-payload:automated-session-ready:v1",
        version: 1,
        digest: "sha256:bae78a03a4505087921f17fc06ac6533b46c2a78597b6e24e02be1ec2a2d628e",
      }),
      payload,
    });
    await manager.query(
      `
INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
VALUES($1,$2,$3,'qa.automated-session.ready',$4,$5,'READY',$6)`,
      [
        eventId,
        session.workspaceId,
        session.projectId,
        JSON.stringify(envelope),
        qaAggregateSnapshotHash(envelope as never),
        session.createdAt,
      ],
    );
    await manager.query(
      `
INSERT INTO audit_events(
  id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,
  authorization_basis,classification_key,attributes
) VALUES($1,$2,$3,$4,$5,'qa.automated-session.plan','SUCCEEDED','READY_WITH_IMMUTABLE_PINS',$6,$7,$8,'INTERNAL',$9)`,
      [
        randomUUID(),
        session.workspaceId,
        session.projectId,
        session.createdAt,
        JSON.stringify(session.createdBy),
        context.correlationId,
        context.causationId,
        JSON.stringify(context.authorizationBasis),
        JSON.stringify({
          values: payload,
          versionRefs: [session.planRevisionRef, session.suiteBindingRef],
        }),
      ],
    );
  }
}
