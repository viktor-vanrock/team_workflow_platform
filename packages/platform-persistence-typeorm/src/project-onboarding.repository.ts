import type { DataSource, EntityManager } from "typeorm";

import {
  type AuthorizedProjectQueryToken,
  onboardingContentHash,
  type ProjectActionApproval,
  type ProjectActionCandidate,
  type ProjectEventEnvelope,
  type ProjectOnboardingRevision,
  type ProjectRegistryRevision,
  type ProjectScope,
} from "@awp/platform-core";

function scopeKey(scope: ProjectScope): string {
  return `${scope.workspaceId}:${scope.projectId}`;
}
function revisionKey(scope: ProjectScope, id: string, version: number): string {
  return `${scopeKey(scope)}:${id}:${version}`;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function returnedRows<T>(value: unknown): readonly T[] {
  return (Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value) as readonly T[];
}

export class InMemoryProjectOnboardingRepository {
  readonly #projects = new Map<
    string,
    Readonly<{
      workspaceId: string;
      projectId: string;
      key: string;
      name: string;
      classificationKey: string;
    }>
  >();
  readonly #projectKeys = new Map<string, string>();
  readonly #registry = new Map<string, ProjectRegistryRevision>();
  readonly #registryHeads = new Map<string, ProjectRegistryRevision>();
  readonly #onboarding = new Map<string, ProjectOnboardingRevision>();
  readonly #onboardingHeads = new Map<string, ProjectOnboardingRevision>();
  readonly #auditEvents: ProjectRegistrationAudit[] = [];
  readonly #outboxEvents: ProjectEventEnvelope[] = [];

  async registerProject(input: ProjectRegistrationPersistenceInput): Promise<void> {
    const projectKey = `${input.workspaceId}:${input.key}`;
    if (this.#projects.has(scopeKey(input)) || this.#projectKeys.has(projectKey))
      throw new Error("PROJECT_ALREADY_REGISTERED");
    if (input.registry.version !== 1 || input.onboarding.version !== 1)
      throw new Error("PROJECT_REGISTRATION_INITIAL_VERSION_REQUIRED");
    this.#projects.set(
      scopeKey(input),
      clone({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        key: input.key,
        name: input.name,
        classificationKey: input.classificationKey,
      }),
    );
    this.#projectKeys.set(projectKey, input.projectId);
    this.#registry.set(
      revisionKey(input.registry, input.registry.revisionId, input.registry.version),
      clone(input.registry),
    );
    this.#registryHeads.set(scopeKey(input.registry), clone(input.registry));
    this.#onboarding.set(
      revisionKey(input.onboarding, input.onboarding.revisionId, input.onboarding.version),
      clone(input.onboarding),
    );
    this.#onboardingHeads.set(scopeKey(input.onboarding), clone(input.onboarding));
    this.#auditEvents.push(clone(input.audit));
    this.#outboxEvents.push(clone(input.outbox));
  }

  audit(): readonly ProjectRegistrationAudit[] {
    return clone(this.#auditEvents);
  }
  outbox(): readonly ProjectEventEnvelope[] {
    return clone(this.#outboxEvents);
  }

  async appendRegistryRevision(revision: ProjectRegistryRevision): Promise<void> {
    const key = revisionKey(revision, revision.revisionId, revision.version);
    if (this.#registry.has(key)) throw new Error("PROJECT_REGISTRY_REVISION_IMMUTABLE");
    const head = this.#registryHeads.get(scopeKey(revision));
    if (head && revision.version !== head.version + 1)
      throw new Error("PROJECT_REGISTRY_VERSION_GAP");
    if (!head && revision.version !== 1) throw new Error("PROJECT_REGISTRY_VERSION_GAP");
    this.#registry.set(key, clone(revision));
    this.#registryHeads.set(scopeKey(revision), clone(revision));
  }

  async registryRevision(
    scope: ProjectScope,
    revisionId: string,
    version: number,
  ): Promise<ProjectRegistryRevision | undefined> {
    return clone(this.#registry.get(revisionKey(scope, revisionId, version)));
  }

  async currentRegistry(scope: ProjectScope): Promise<ProjectRegistryRevision | undefined> {
    return clone(this.#registryHeads.get(scopeKey(scope)));
  }

  async appendOnboardingRevision(revision: ProjectOnboardingRevision): Promise<void> {
    const key = revisionKey(revision, revision.revisionId, revision.version);
    if (this.#onboarding.has(key)) throw new Error("PROJECT_ONBOARDING_REVISION_IMMUTABLE");
    const head = this.#onboardingHeads.get(scopeKey(revision));
    if ((head && revision.version !== head.version + 1) || (!head && revision.version !== 1))
      throw new Error("PROJECT_ONBOARDING_VERSION_GAP");
    this.#onboarding.set(key, clone(revision));
    this.#onboardingHeads.set(scopeKey(revision), clone(revision));
  }

  async currentOnboarding(scope: ProjectScope): Promise<ProjectOnboardingRevision | undefined> {
    return clone(this.#onboardingHeads.get(scopeKey(scope)));
  }
}

export interface ProjectRegistrationAudit extends ProjectScope {
  readonly auditId: string;
  readonly action: "PROJECT_REGISTERED";
  readonly outcome: "SUCCEEDED";
  readonly before: null;
  readonly after: ProjectRegistryRevision;
  readonly actor: ProjectRegistryRevision["createdBy"];
  readonly occurredAt: string;
  readonly reasonCode: "PROJECT_REGISTERED";
  readonly correlationId: string;
  readonly causationId: string;
  readonly classificationKey: string;
}

export interface ProjectRegistrationPersistenceInput extends ProjectScope {
  readonly key: string;
  readonly name: string;
  readonly classificationKey: string;
  readonly registry: ProjectRegistryRevision;
  readonly onboarding: ProjectOnboardingRevision;
  readonly audit: ProjectRegistrationAudit;
  readonly outbox: ProjectEventEnvelope;
}

export class ProjectOnboardingRepository {
  constructor(private readonly source: DataSource) {}

  async authorizedCatalog(
    token: AuthorizedProjectQueryToken,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (token.projectIds.length === 0) return [];
    return (await this.source.query(
      `SELECT p.id AS project_id,p.key,p.name,p.classification_key,h.current_stage,h.current_capability_mode,h.current_operational_state
         FROM projects p
         LEFT JOIN project_onboarding_headers h ON h.workspace_id=p.workspace_id AND h.project_id=p.id
        WHERE p.workspace_id=$1 AND p.id=ANY($2::uuid[])
        ORDER BY p.key,p.id`,
      [token.workspaceId, token.projectIds],
    )) as readonly Readonly<Record<string, unknown>>[];
  }

  async authorizedOnboarding(
    token: AuthorizedProjectQueryToken,
    projectId: string,
  ): Promise<ProjectOnboardingRevision | undefined> {
    token.assert(projectId, 0, "READ");
    return this.currentOnboarding({ workspaceId: token.workspaceId, projectId });
  }

  async suspendProject(
    input: ProjectScope &
      Readonly<{
        expectedOnboardingVersion: number;
        incidentRef: string;
        reason: string;
        actorId: string;
        occurredAt: string;
        correlationId: string;
      }>,
  ): Promise<void> {
    if (!input.incidentRef || !input.reason.trim())
      throw new Error("PROJECT_SUSPEND_INCIDENT_REASON_REQUIRED");
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `project-onboarding:${input.workspaceId}`,
      ]);
      const updated = (await manager.query(
        "UPDATE project_onboarding_headers SET current_operational_state='SUSPENDED',row_version=row_version+1,updated_at=$4 WHERE workspace_id=$1 AND project_id=$2 AND current_version=$3 AND current_operational_state='ACTIVE' RETURNING onboarding_id",
        [input.workspaceId, input.projectId, input.expectedOnboardingVersion, input.occurredAt],
      )) as readonly unknown[];
      if (updated.length !== 1) throw new Error("ONBOARDING_VERSION_CONFLICT");
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES(gen_random_uuid(),$1,$2,$3,$4,'PROJECT_SUSPEND','SUCCEEDED','EMERGENCY_SUSPEND',$5,$5,'{}','INTERNAL',$6)",
        [
          input.workspaceId,
          input.projectId,
          input.occurredAt,
          JSON.stringify({ principalId: input.actorId }),
          input.correlationId,
          JSON.stringify({ incidentRef: input.incidentRef, reason: input.reason }),
        ],
      );
    });
  }

  async registerProject(input: ProjectRegistrationPersistenceInput): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) =>
      this.insertRegistration(manager, input),
    );
  }

  async insertRegistration(
    manager: EntityManager,
    input: ProjectRegistrationPersistenceInput,
  ): Promise<void> {
    await manager.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,row_version,created_at,registration_status,current_registry_version) VALUES($1,$2,$3,$4,'ACTIVE',$5,1,$6,'ACTIVE',1)",
      [
        input.projectId,
        input.workspaceId,
        input.key,
        input.name,
        input.classificationKey,
        input.registry.createdAt,
      ],
    );
    await manager.query(
      `INSERT INTO project_registry_revisions(revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,last_verified_at,next_verification_at,reason,created_by,created_at,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        input.registry.revisionId,
        input.workspaceId,
        input.projectId,
        input.registry.version,
        input.registry.key,
        input.registry.name,
        JSON.stringify(input.registry.ownerIds),
        input.registry.criticalityKey,
        input.registry.dataClassificationKey,
        input.registry.verificationStatus,
        input.registry.lastVerifiedAt ?? null,
        input.registry.nextVerificationAt ?? null,
        input.registry.reason,
        input.registry.createdBy.principalId,
        input.registry.createdAt,
        JSON.stringify(input.registry),
        input.registry.contentHash,
      ],
    );
    await manager.query(
      `INSERT INTO project_onboarding_headers(onboarding_id,workspace_id,project_id,current_version,current_stage,current_capability_mode,current_operational_state,intended_capability_mode,row_version,created_at,updated_at)
       VALUES($1,$2,$3,1,$4,$5,$6,$7,1,$8,$8)`,
      [
        input.onboarding.onboardingId,
        input.workspaceId,
        input.projectId,
        input.onboarding.stage,
        input.onboarding.qaCapabilityMode,
        input.onboarding.operationalState,
        input.onboarding.intendedCapabilityMode,
        input.onboarding.createdAt,
      ],
    );
    await manager.query(
      `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,binding_ref,qa_project_context_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,incident_ref,actor,correlation_id,causation_id,created_at,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        input.onboarding.revisionId,
        input.onboarding.onboardingId,
        input.workspaceId,
        input.projectId,
        input.onboarding.version,
        input.onboarding.stage,
        input.onboarding.qaCapabilityMode,
        input.onboarding.operationalState,
        input.onboarding.intendedCapabilityMode,
        JSON.stringify(input.onboarding.projectRegistryRef),
        input.onboarding.bindingRef ? JSON.stringify(input.onboarding.bindingRef) : null,
        input.onboarding.qaProjectContextRef
          ? JSON.stringify(input.onboarding.qaProjectContextRef)
          : null,
        input.onboarding.starterEntitlementSetHash,
        JSON.stringify(input.onboarding.gateResultRefs),
        input.onboarding.ownerSetHash,
        input.onboarding.reasonCode,
        input.onboarding.reason,
        input.onboarding.incidentRef ?? null,
        JSON.stringify(input.onboarding.actor),
        input.onboarding.correlationId,
        input.onboarding.causationId ?? null,
        input.onboarding.createdAt,
        JSON.stringify(input.onboarding),
        input.onboarding.contentHash,
      ],
    );
    await manager.query(
      `INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        input.audit.auditId,
        input.workspaceId,
        input.projectId,
        input.audit.occurredAt,
        JSON.stringify(input.audit.actor),
        input.audit.action,
        input.audit.outcome,
        input.audit.reasonCode,
        input.audit.correlationId,
        input.audit.causationId,
        JSON.stringify(input.audit.actor.authorizationBasisRef),
        input.audit.classificationKey,
        JSON.stringify({ before: input.audit.before, after: input.audit.after }),
      ],
    );
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        input.outbox.payload.eventId,
        input.workspaceId,
        input.projectId,
        input.outbox.payload.eventType,
        JSON.stringify(input.outbox),
        onboardingContentHash(input.outbox as never),
        input.outbox.payload.occurredAt,
      ],
    );
  }

  async currentRegistry(scope: ProjectScope): Promise<ProjectRegistryRevision | undefined> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM projects p
       JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version
       WHERE p.workspace_id=$1 AND p.id=$2`,
      [scope.workspaceId, scope.projectId],
    )) as readonly { semantic_body: ProjectRegistryRevision }[];
    return rows[0]?.semantic_body;
  }

  async currentOnboarding(scope: ProjectScope): Promise<ProjectOnboardingRevision | undefined> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM project_onboarding_headers h
       JOIN project_onboarding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.onboarding_id=h.onboarding_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2`,
      [scope.workspaceId, scope.projectId],
    )) as readonly { semantic_body: ProjectOnboardingRevision }[];
    return rows[0]?.semantic_body;
  }

  async withAdministrativeActionLocks<TResult>(
    input: ProjectScope &
      Readonly<{
        expectedOnboardingVersion: number;
        bindingId?: string;
      }>,
    work: (manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      // One stable lock order for every publish/retire/rollback/pilot action:
      // Workspace rollout domain -> Project onboarding -> Binding -> action/Approval rows.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `project-onboarding:${input.workspaceId}`,
      ]);
      const rows = (await manager.query(
        "SELECT current_version FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
        [input.workspaceId, input.projectId],
      )) as readonly Readonly<{ current_version: number | string }>[];
      const head = (Array.isArray(rows[0]) ? rows[0][0] : rows[0]) as
        (typeof rows)[number] | undefined;
      if (!head) throw new Error("PROJECT_ONBOARDING_NOT_FOUND");
      if (Number(head.current_version) !== input.expectedOnboardingVersion)
        throw new Error("ONBOARDING_VERSION_CONFLICT");
      if (input.bindingId) {
        const bindings = (await manager.query(
          "SELECT id FROM project_integration_binding_headers WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
          [input.workspaceId, input.projectId, input.bindingId],
        )) as readonly unknown[];
        if (bindings.length === 0) throw new Error("BINDING_HEADER_NOT_FOUND");
      }
      return await work(manager);
    });
  }

  /** Activation replay must inspect its locked action even after the head advanced. */
  async withPilotActivationLocks<TResult>(
    input: ProjectScope,
    work: (manager: EntityManager) => Promise<TResult>,
  ): Promise<TResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.source.transaction("SERIALIZABLE", async (manager) => {
          await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            `project-onboarding:${input.workspaceId}`,
          ]);
          const rows = (await manager.query(
            "SELECT current_version FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
            [input.workspaceId, input.projectId],
          )) as readonly unknown[];
          if (rows.length === 0) throw new Error("PROJECT_ONBOARDING_NOT_FOUND");
          return await work(manager);
        });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (code !== "40001" || attempt === 2) throw error;
      }
    }
    throw new Error("PILOT_ACTIVATION_SERIALIZATION_RETRY_EXHAUSTED");
  }

  async acquireFirstPilotRolloutLease(
    input: ProjectScope &
      Readonly<{
        expectedOnboardingVersion: number;
        actorId: string;
        acquiredAt: string;
        expiresAt: string;
      }>,
  ): Promise<Readonly<{ leaseVersion: number; recoveredExpiredLease: boolean }>> {
    if (
      Number.isNaN(Date.parse(input.acquiredAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(input.acquiredAt)
    )
      throw new Error("ROLLOUT_LEASE_INVALID");
    return await this.withAdministrativeActionLocks(input, async (manager) => {
      return await this.acquireFirstPilotRolloutLeaseInTransaction(manager, input);
    });
  }

  /**
   * Acquires the rollout lease inside an already-open administrative transaction.
   * Callers must first take the Workspace advisory lock and onboarding header lock;
   * this method deliberately never starts a nested transaction.
   */
  async acquireFirstPilotRolloutLeaseInTransaction(
    manager: EntityManager,
    input: ProjectScope &
      Readonly<{
        actorId: string;
        acquiredAt: string;
        expiresAt: string;
      }>,
  ): Promise<Readonly<{ leaseVersion: number; recoveredExpiredLease: boolean }>> {
    if (
      !manager ||
      Number.isNaN(Date.parse(input.acquiredAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(input.acquiredAt)
    )
      throw new Error("ROLLOUT_LEASE_INVALID");
    const values = (await manager.query(
      "SELECT holder_project_id,lease_version,expires_at FROM workspace_project_rollout_leases WHERE workspace_id=$1 FOR UPDATE",
      [input.workspaceId],
    )) as readonly Readonly<{
      holder_project_id: string;
      lease_version: number | string;
      expires_at: string | Date;
    }>[];
    const current = (Array.isArray(values[0]) ? values[0][0] : values[0]) as
      (typeof values)[number] | undefined;
    if (
      current &&
      current.holder_project_id !== input.projectId &&
      Date.parse(String(current.expires_at)) > Date.parse(input.acquiredAt)
    )
      throw new Error("ROLLOUT_LEASE_HELD");
    const leaseVersion = Number(current?.lease_version ?? 0) + 1;
    await manager.query(
      `INSERT INTO workspace_project_rollout_leases(workspace_id,holder_project_id,lease_version,acquired_by,acquired_at,expires_at,purpose,row_version)
       VALUES($1,$2,$3,$4,$5,$6,'FIRST_PILOT_ACTIVATION',1)
       ON CONFLICT(workspace_id) DO UPDATE SET holder_project_id=excluded.holder_project_id,lease_version=excluded.lease_version,acquired_by=excluded.acquired_by,acquired_at=excluded.acquired_at,expires_at=excluded.expires_at,row_version=workspace_project_rollout_leases.row_version+1`,
      [
        input.workspaceId,
        input.projectId,
        leaseVersion,
        input.actorId,
        input.acquiredAt,
        input.expiresAt,
      ],
    );
    return Object.freeze({
      leaseVersion,
      recoveredExpiredLease: current !== undefined && current.holder_project_id !== input.projectId,
    });
  }

  /** Persists every activation consequence in the caller's existing transaction. */
  async commitPilotActivationInTransaction(
    manager: EntityManager,
    input: ProjectScope &
      Readonly<{
        previous: ProjectOnboardingRevision;
        revision: ProjectOnboardingRevision;
        action: ProjectActionCandidate;
        approval: ProjectActionApproval & Readonly<{ consumedAt: string }>;
        lease: Readonly<{
          workspaceId: string;
          projectId: string;
          leaseVersion: number;
          actorId: string;
          acquiredAt: string;
          expiresAt: string;
        }>;
        audit: Readonly<{
          auditId: string;
          action: "ONBOARDING_PILOT_ACTIVATE";
          actionId: string;
          approvalId: string;
          revisionHash: string;
          leaseVersion: number;
          actor: ProjectActionApproval["approver"];
          correlationId: string;
          occurredAt: string;
        }>;
        outbox: ProjectEventEnvelope;
      }>,
  ): Promise<void> {
    if (
      input.revision.version !== input.previous.version + 1 ||
      input.revision.stage !== "PILOT_ACTIVE" ||
      input.action.contentHash !== input.approval.targetHash ||
      input.audit.leaseVersion !== input.lease.leaseVersion ||
      input.audit.revisionHash !== input.revision.contentHash ||
      input.outbox.payload.subjectRef.contentHash !== input.revision.contentHash
    )
      throw new Error("PILOT_ACTIVATION_PERSISTENCE_INPUT_INVALID");
    const approvalUpdate = returnedRows(
      await manager.query(
        `UPDATE approvals SET subject=$6,effect_authorization_state='CONSUMED',row_version=row_version+1
       WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND action_kind='ONBOARDING_PILOT_ACTIVATE' AND action_id=$4 AND subject_hash=$5 AND decision_state='APPROVED' AND effect_authorization_state='AUTHORIZED' RETURNING id`,
        [
          input.workspaceId,
          input.projectId,
          input.approval.approvalId,
          input.action.actionId,
          input.approval.targetHash,
          JSON.stringify(input.approval),
        ],
      ),
    );
    if (approvalUpdate.length !== 1) throw new Error("PILOT_ACTIVATION_APPROVAL_CONFLICT");
    const result = Object.freeze({
      actionId: input.action.actionId,
      approvalId: input.approval.approvalId,
      revision: input.revision,
      lease: input.lease,
      replayed: false,
    });
    const actionUpdate = returnedRows(
      await manager.query(
        `UPDATE platform_actions SET state='COMPLETED',result=$5,row_version=row_version+1
       WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND candidate_hash=$4 AND state<>'COMPLETED' RETURNING id`,
        [
          input.workspaceId,
          input.projectId,
          input.action.actionId,
          input.action.contentHash,
          JSON.stringify(result),
        ],
      ),
    );
    if (actionUpdate.length !== 1) throw new Error("PILOT_ACTIVATION_ACTION_CONFLICT");
    const headerUpdate = returnedRows(
      await manager.query(
        `UPDATE project_onboarding_headers SET current_version=$4,current_stage=$5,current_capability_mode=$6,current_operational_state=$7,intended_capability_mode=$8,row_version=row_version+1,updated_at=$9
       WHERE workspace_id=$1 AND project_id=$2 AND current_version=$3 RETURNING onboarding_id`,
        [
          input.workspaceId,
          input.projectId,
          input.previous.version,
          input.revision.version,
          input.revision.stage,
          input.revision.qaCapabilityMode,
          input.revision.operationalState,
          input.revision.intendedCapabilityMode,
          input.revision.createdAt,
        ],
      ),
    );
    if (headerUpdate.length !== 1) throw new Error("ONBOARDING_VERSION_CONFLICT");
    await manager.query(
      `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,binding_ref,qa_project_context_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,incident_ref,actor,correlation_id,causation_id,created_at,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        input.revision.revisionId,
        input.revision.onboardingId,
        input.workspaceId,
        input.projectId,
        input.revision.version,
        input.revision.stage,
        input.revision.qaCapabilityMode,
        input.revision.operationalState,
        input.revision.intendedCapabilityMode,
        JSON.stringify(input.revision.projectRegistryRef),
        input.revision.bindingRef ? JSON.stringify(input.revision.bindingRef) : null,
        input.revision.qaProjectContextRef
          ? JSON.stringify(input.revision.qaProjectContextRef)
          : null,
        input.revision.starterEntitlementSetHash,
        JSON.stringify(input.revision.gateResultRefs),
        input.revision.ownerSetHash,
        input.revision.reasonCode,
        input.revision.reason,
        input.revision.incidentRef ?? null,
        JSON.stringify(input.revision.actor),
        input.revision.correlationId,
        input.revision.causationId ?? null,
        input.revision.createdAt,
        JSON.stringify(input.revision),
        input.revision.contentHash,
      ],
    );
    await manager.query(
      `INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes)
       VALUES($1,$2,$3,$4,$5,'ONBOARDING_PILOT_ACTIVATE','SUCCEEDED','ONBOARDING_PILOT_ACTIVATED',$6,$7,$8,'CONFIDENTIAL',$9)`,
      [
        input.audit.auditId,
        input.workspaceId,
        input.projectId,
        input.audit.occurredAt,
        JSON.stringify(input.audit.actor),
        input.audit.correlationId,
        input.audit.actionId,
        JSON.stringify(input.audit.actor.authorizationBasisRef),
        JSON.stringify({
          approvalId: input.audit.approvalId,
          revisionHash: input.audit.revisionHash,
          leaseVersion: input.audit.leaseVersion,
        }),
      ],
    );
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        input.outbox.payload.eventId,
        input.workspaceId,
        input.projectId,
        input.outbox.payload.eventType,
        JSON.stringify(input.outbox),
        onboardingContentHash(input.outbox as never),
        input.outbox.payload.occurredAt,
      ],
    );
  }
}
