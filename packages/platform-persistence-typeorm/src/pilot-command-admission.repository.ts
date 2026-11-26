import type { DataSource, EntityManager } from "typeorm";

import {
  assertExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  pilotCommandPrincipal,
  type ConnectorCommand,
  type PilotEffectContext,
} from "@awp/platform-core";

export interface StoredPilotCommandAdmission {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly targetHash: string;
  readonly expectedOnboardingVersion: number;
  readonly context: PilotEffectContext;
}

const digest = /^sha256:[a-f0-9]{64}$/u;
function validate(command: ConnectorCommand, admission: StoredPilotCommandAdmission): void {
  if (
    admission.commandId !== command.id ||
    admission.payloadHash !== command.payloadHash ||
    admission.targetHash !== command.targetHash ||
    !digest.test(admission.payloadHash) ||
    !digest.test(admission.targetHash) ||
    admission.context.principalId !== pilotCommandPrincipal(command) ||
    !["BUSINESS", "SANDBOX_CONFORMANCE"].includes(admission.context.purpose) ||
    !Number.isSafeInteger(admission.expectedOnboardingVersion) ||
    admission.expectedOnboardingVersion < 1
  )
    throw new Error("PILOT_COMMAND_ADMISSION_CONFLICT");
  [
    admission.context.deploymentRef,
    admission.context.cohortRef,
    admission.context.fenceRef,
  ].forEach(assertExactRevisionRef);
}

async function validateRetryProvenance(
  query: Pick<EntityManager, "query">,
  command: ConnectorCommand,
): Promise<void> {
  if (pilotCommandPrincipal(command) === command.actor.principalId) return;
  const rows = (await query.query(
    `SELECT 1 FROM qa_automation_attempts a
     JOIN identities human ON human.id::text=a.initiating_human_principal_id AND human.kind='HUMAN'
     JOIN identities service ON service.id::text=a.executing_service_principal_id AND service.kind='SERVICE'
     WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.connector_command_id=$3
       AND a.lineage_kind='AUTO_INFRA_RETRY' AND a.initiating_human_principal_id=$4
       AND a.executing_service_principal_id=$5 AND a.effect_idempotency_key=$6
       AND a.work_item_id::text=$7`,
    [
      command.workspaceId,
      command.projectId,
      command.id,
      pilotCommandPrincipal(command),
      command.actor.principalId,
      command.effectIdempotencyKey,
      command.source.sourceWorkItemId ?? "",
    ],
  )) as readonly unknown[];
  if (rows.length !== 1) throw new Error("PILOT_RETRY_PROVENANCE_INVALID");
}

/** The writer is server-owned and must participate in the transaction that creates the command. */
export class PilotCommandAdmissionRepository {
  constructor(private readonly source: Pick<DataSource, "query">) {}

  async insert(
    manager: EntityManager,
    command: ConnectorCommand,
    admission: StoredPilotCommandAdmission,
  ): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) throw new Error("PILOT_TRANSACTION_REQUIRED");
    validate(command, admission);
    await validateRetryProvenance(manager, command);
    await manager.query(
      `INSERT INTO pilot_command_admissions
       (workspace_id,project_id,command_id,principal_id,purpose,payload_hash,target_hash,
        expected_onboarding_version,deployment_ref,cohort_ref,fence_ref,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
      [
        command.workspaceId,
        command.projectId,
        command.id,
        admission.context.principalId,
        admission.context.purpose,
        admission.payloadHash,
        admission.targetHash,
        admission.expectedOnboardingVersion,
        JSON.stringify(admission.context.deploymentRef),
        JSON.stringify(admission.context.cohortRef),
        JSON.stringify(admission.context.fenceRef),
        command.createdAt,
      ],
    );
    const existing = await this.load(command, manager);
    if (!existing || pilotContentHash(existing) !== pilotContentHash(admission))
      throw new Error("PILOT_COMMAND_ADMISSION_CONFLICT");
  }

  async load(
    command: ConnectorCommand,
    manager?: EntityManager,
  ): Promise<StoredPilotCommandAdmission | undefined> {
    const query = manager ?? this.source;
    await validateRetryProvenance(query as Pick<EntityManager, "query">, command);
    const rows = (await query.query(
      `SELECT command_id,principal_id,purpose,payload_hash,target_hash,expected_onboarding_version,
              deployment_ref,cohort_ref,fence_ref FROM pilot_command_admissions
       WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3`,
      [command.workspaceId, command.projectId, command.id],
    )) as readonly {
      command_id: string;
      principal_id: string;
      purpose: PilotEffectContext["purpose"];
      payload_hash: string;
      target_hash: string;
      expected_onboarding_version: number;
      deployment_ref: PilotEffectContext["deploymentRef"];
      cohort_ref: PilotEffectContext["cohortRef"];
      fence_ref: PilotEffectContext["fenceRef"];
    }[];
    const row = rows[0];
    if (!row) return undefined;
    const result = {
      commandId: row.command_id,
      payloadHash: row.payload_hash,
      targetHash: row.target_hash,
      expectedOnboardingVersion: row.expected_onboarding_version,
      context: {
        principalId: row.principal_id,
        purpose: row.purpose,
        deploymentRef: row.deployment_ref,
        cohortRef: row.cohort_ref,
        fenceRef: row.fence_ref,
      },
    };
    validate(command, result);
    return freezePilotValue(result);
  }
}
