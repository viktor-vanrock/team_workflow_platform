import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  activateQaAutomationQuarantine,
  projectQaAutomationQuarantine,
  qaAggregateSnapshotHash,
  type QaAutomationQuarantine,
  type QaAutomationQuarantinePolicy,
  type QaAutomationQuarantineProjection,
  type QaAutomationQuarantineRevision,
  type QaAutomationQuarantineSubject,
  type QaContentHash,
  type QaWorkspaceContext,
  reviseQaAutomationQuarantine,
} from "@awp/competency-qa/node";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import { assertQaAutomationHuman } from "./qa-automation-security.ts";

export const QA_AUTOMATION_QUARANTINES_API = Symbol("QA_AUTOMATION_QUARANTINES_API");

type Row = Readonly<Record<string, unknown>>;

interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
}

interface QuarantineRevisionApiProjection {
  readonly schemaVersion: "automation-quarantine-revision@1.0.0";
  readonly quarantineRevisionId: string;
  readonly quarantineId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionNo: number;
  readonly previousRevisionId?: string;
  readonly previousRevisionHash?: string;
  readonly subject: QaAutomationQuarantineSubject;
  readonly action: "ACTIVATE" | "LIFT";
  readonly ownerPrincipalId: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly evidenceSetHash: string;
  readonly policyRef: string;
  readonly policyHash: string;
  readonly expiresAt?: string;
  readonly actorPrincipalId: string;
  readonly authorizationBasisHash: string;
  readonly createdAt: string;
  readonly contentHash: string;
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function timestamp(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function subject(row: Row): QaAutomationQuarantineSubject {
  return String(row.subject_kind) === "SUITE_BINDING_VERSION"
    ? Object.freeze({
        kind: "SUITE_BINDING_VERSION",
        suiteBindingRef: Object.freeze({
          id: String(row.suite_binding_id),
          version: Number(row.suite_binding_version),
          contentHash: String(row.suite_binding_content_hash) as QaContentHash,
        }),
      })
    : Object.freeze({
        kind: "INFRASTRUCTURE_CODE",
        infrastructureCode: String(row.infrastructure_code),
      });
}

function quarantine(row: Row): QaAutomationQuarantine {
  return Object.freeze({
    schemaVersion: "automation-quarantine@1.0.0",
    quarantineId: String(row.quarantine_id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    subject: subject(row),
    currentRevisionId: String(row.current_revision_id),
    currentRevisionNo: Number(row.current_revision_no),
    currentRevisionHash: String(row.current_revision_hash) as QaContentHash,
    currentAction: String(row.current_action) as QaAutomationQuarantine["currentAction"],
    ...(row.current_expires_at === null || row.current_expires_at === undefined
      ? {}
      : { currentExpiresAt: timestamp(row.current_expires_at) }),
    resourceVersion: Number(row.resource_version),
    createdByPrincipalId: String(row.created_by_principal_id),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function revision(row: Row): QaAutomationQuarantineRevision {
  return Object.freeze({
    schemaVersion: "automation-quarantine-revision@1.0.0",
    quarantineRevisionId: String(row.quarantine_revision_id),
    quarantineId: String(row.quarantine_id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    revisionNo: Number(row.revision_no),
    ...(row.previous_revision_id === null || row.previous_revision_id === undefined
      ? {}
      : { previousRevisionId: String(row.previous_revision_id) }),
    ...(row.previous_revision_hash === null || row.previous_revision_hash === undefined
      ? {}
      : { previousRevisionHash: String(row.previous_revision_hash) as QaContentHash }),
    subject: subject(row),
    action: String(row.action) as QaAutomationQuarantineRevision["action"],
    ownerPrincipalId: String(row.owner_principal_id),
    reason: String(row.reason),
    evidenceRefs: Object.freeze([...json<readonly string[]>(row.evidence_refs)]),
    evidenceSetHash: String(row.evidence_set_hash) as QaContentHash,
    policyRef: String(row.policy_ref),
    policyHash: String(row.policy_content_hash) as QaContentHash,
    maximumLifetimeSeconds: Number(row.maximum_lifetime_seconds),
    ...(row.expires_at === null || row.expires_at === undefined
      ? {}
      : { expiresAt: timestamp(row.expires_at) }),
    actorPrincipalId: String(row.actor_principal_id),
    authorizationBasisHash: String(row.authorization_basis_hash) as QaContentHash,
    createdAt: timestamp(row.created_at),
    correlationId: String(row.correlation_id),
    causationId: String(row.causation_id),
    contentHash: String(row.content_hash) as QaContentHash,
  });
}

function apiRevision(value: QaAutomationQuarantineRevision): QuarantineRevisionApiProjection {
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    quarantineRevisionId: value.quarantineRevisionId,
    quarantineId: value.quarantineId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    revisionNo: value.revisionNo,
    ...(value.previousRevisionId === undefined
      ? {}
      : {
          previousRevisionId: value.previousRevisionId,
          previousRevisionHash: value.previousRevisionHash!,
        }),
    subject: value.subject,
    action: value.action,
    ownerPrincipalId: value.ownerPrincipalId,
    reason: value.reason,
    evidenceRefs: value.evidenceRefs,
    evidenceSetHash: value.evidenceSetHash,
    policyRef: value.policyRef,
    policyHash: value.policyHash,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    actorPrincipalId: value.actorPrincipalId,
    authorizationBasisHash: value.authorizationBasisHash,
    createdAt: value.createdAt,
    contentHash: value.contentHash,
  });
}

async function rows(
  executor: DataSource | EntityManager,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly Row[]> {
  const raw = (await executor.query(sql, parameters)) as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
}

async function insertRevision(
  manager: EntityManager,
  value: QaAutomationQuarantineRevision,
): Promise<void> {
  const suite =
    value.subject.kind === "SUITE_BINDING_VERSION" ? value.subject.suiteBindingRef : undefined;
  await manager.query(
    `
INSERT INTO qa_automation_quarantine_revisions(
  quarantine_revision_id,quarantine_id,workspace_id,project_id,revision_no,previous_revision_id,previous_revision_hash,
  subject_kind,suite_binding_id,suite_binding_version,suite_binding_content_hash,infrastructure_code,action,
  owner_principal_id,reason,evidence_refs,evidence_set_hash,policy_ref,policy_content_hash,maximum_lifetime_seconds,
  expires_at,actor_kind,actor_principal_id,authorization_basis_hash,created_at,correlation_id,causation_id,content_hash
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'HUMAN',$22,$23,$24,$25,$26,$27)`,
    [
      value.quarantineRevisionId,
      value.quarantineId,
      value.workspaceId,
      value.projectId,
      value.revisionNo,
      value.previousRevisionId ?? null,
      value.previousRevisionHash ?? null,
      value.subject.kind,
      suite?.id ?? null,
      suite?.version ?? null,
      suite?.contentHash ?? null,
      value.subject.kind === "INFRASTRUCTURE_CODE" ? value.subject.infrastructureCode : null,
      value.action,
      value.ownerPrincipalId,
      value.reason,
      JSON.stringify(value.evidenceRefs),
      value.evidenceSetHash,
      value.policyRef,
      value.policyHash,
      value.maximumLifetimeSeconds,
      value.expiresAt ?? null,
      value.actorPrincipalId,
      value.authorizationBasisHash,
      value.createdAt,
      value.correlationId,
      value.causationId,
      value.contentHash,
    ],
  );
}

async function insertEvent(
  manager: EntityManager,
  event: Readonly<
    Record<string, unknown> & {
      eventId: string;
      workspaceId: string;
      projectId: string;
      eventType: string;
      recordedAt: string;
    }
  >,
): Promise<void> {
  await manager.query(
    `INSERT INTO event_outbox(
    id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at
  ) VALUES($1,$2,$3,$4,$5,$6,'READY',$7) ON CONFLICT(id) DO NOTHING`,
    [
      event.eventId,
      event.workspaceId,
      event.projectId,
      event.eventType,
      JSON.stringify(event),
      qaAggregateSnapshotHash(event as never),
      event.recordedAt,
    ],
  );
}

export class TypeOrmQaAutomationQuarantineApi {
  constructor(
    private readonly source: DataSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
  ): Promise<readonly QaAutomationQuarantineProjection[]> {
    const found = await rows(
      this.source,
      "SELECT * FROM qa_automation_quarantines WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at DESC,quarantine_id",
      [scope.workspaceId, scope.projectId],
    );
    const observedAt = this.now();
    return Object.freeze(
      found.map((row) => projectQaAutomationQuarantine(quarantine(row), observedAt)),
    );
  }

  async get(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    quarantineId: string,
  ): Promise<QaAutomationQuarantineProjection | undefined> {
    const found = await rows(
      this.source,
      "SELECT * FROM qa_automation_quarantines WHERE workspace_id=$1 AND project_id=$2 AND quarantine_id=$3",
      [scope.workspaceId, scope.projectId, quarantineId],
    );
    return found[0] === undefined
      ? undefined
      : projectQaAutomationQuarantine(quarantine(found[0]), this.now());
  }

  async revisions(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    quarantineId: string,
  ): Promise<readonly QuarantineRevisionApiProjection[] | undefined> {
    const found = await rows(
      this.source,
      "SELECT * FROM qa_automation_quarantine_revisions WHERE workspace_id=$1 AND project_id=$2 AND quarantine_id=$3 ORDER BY revision_no",
      [scope.workspaceId, scope.projectId, quarantineId],
    );
    return found.length === 0
      ? undefined
      : Object.freeze(found.map((row) => apiRevision(revision(row))));
  }

  async activate(
    input: Readonly<{
      context: QaWorkspaceContext;
      idempotencyKey: string;
      subject: QaAutomationQuarantineSubject;
      ownerPrincipalId: string;
      reason: string;
      evidenceRefs: readonly string[];
      policyRef: string;
      policyHash: QaContentHash;
      expiresAt: string;
      authorizationBasisHash: QaContentHash;
    }>,
  ): Promise<Readonly<{ created: boolean; value: QaAutomationQuarantineProjection }>> {
    const subjectKey = qaAggregateSnapshotHash(input.subject as never);
    const quarantineId = deterministicUuid(
      `qa-automation-quarantine:${input.context.scope.workspaceId}:${input.context.scope.kind === "PROJECT" ? input.context.scope.projectId : "workspace"}:${subjectKey}`,
    );
    const revisionId = deterministicUuid(
      `qa-automation-quarantine-activation:${quarantineId}:${qaAggregateSnapshotHash(input.idempotencyKey as never)}`,
    );
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-automation-quarantine:${quarantineId}`,
      ]);
      const existingRevision = (
        await rows(
          manager,
          "SELECT * FROM qa_automation_quarantine_revisions WHERE workspace_id=$1 AND project_id=$2 AND quarantine_revision_id=$3",
          [
            input.context.scope.workspaceId,
            input.context.scope.kind === "PROJECT" ? input.context.scope.projectId : "",
            revisionId,
          ],
        )
      )[0];
      if (existingRevision) {
        const stored = revision(existingRevision);
        const expectedEvidence = [...new Set(input.evidenceRefs)].sort();
        if (
          stored.action !== "ACTIVATE" ||
          stored.ownerPrincipalId !== input.ownerPrincipalId ||
          stored.reason !== input.reason.trim() ||
          JSON.stringify(stored.evidenceRefs) !== JSON.stringify(expectedEvidence) ||
          stored.policyRef !== input.policyRef ||
          stored.policyHash !== input.policyHash ||
          stored.expiresAt !== new Date(input.expiresAt).toISOString() ||
          qaAggregateSnapshotHash(stored.subject as never) !== subjectKey
        )
          throw new Error("QA_AUTOMATION_QUARANTINE_IDEMPOTENCY_CONFLICT");
        const current = (
          await rows(
            manager,
            "SELECT * FROM qa_automation_quarantines WHERE workspace_id=$1 AND project_id=$2 AND quarantine_id=$3",
            [stored.workspaceId, stored.projectId, stored.quarantineId],
          )
        )[0]!;
        return Object.freeze({
          created: false,
          value: projectQaAutomationQuarantine(quarantine(current), this.now()),
        });
      }
      const scope = input.context.scope;
      if (scope.kind !== "PROJECT")
        throw new Error("QA_AUTOMATION_QUARANTINE_PROJECT_SCOPE_REQUIRED");
      const existingSubject = await rows(
        manager,
        `SELECT quarantine_id FROM qa_automation_quarantines
        WHERE workspace_id=$1 AND project_id=$2 AND ((subject_kind='INFRASTRUCTURE_CODE' AND infrastructure_code=$3)
          OR (subject_kind='SUITE_BINDING_VERSION' AND suite_binding_id=$4 AND suite_binding_version=$5 AND suite_binding_content_hash=$6))`,
        [
          scope.workspaceId,
          scope.projectId,
          input.subject.kind === "INFRASTRUCTURE_CODE" ? input.subject.infrastructureCode : null,
          input.subject.kind === "SUITE_BINDING_VERSION" ? input.subject.suiteBindingRef.id : null,
          input.subject.kind === "SUITE_BINDING_VERSION"
            ? input.subject.suiteBindingRef.version
            : null,
          input.subject.kind === "SUITE_BINDING_VERSION"
            ? input.subject.suiteBindingRef.contentHash
            : null,
        ],
      );
      if (existingSubject.length > 0) throw new Error("QA_AUTOMATION_QUARANTINE_SUBJECT_EXISTS");
      await this.#assertAuthority(
        manager,
        scope,
        input.ownerPrincipalId,
        input.subject,
        input.policyRef,
        input.policyHash,
      );
      const policy: QaAutomationQuarantinePolicy = Object.freeze({
        policyRef: input.policyRef,
        policyHash: input.policyHash,
        maximumLifetimeSeconds: 604_800,
        allowedSubjectKinds: Object.freeze([
          "SUITE_BINDING_VERSION",
          "INFRASTRUCTURE_CODE",
        ] as const),
      });
      const createdAt = this.now().toISOString();
      const change = activateQaAutomationQuarantine({
        context: input.context,
        quarantineId,
        quarantineRevisionId: revisionId,
        subject: input.subject,
        ownerPrincipalId: input.ownerPrincipalId,
        reason: input.reason,
        evidenceRefs: input.evidenceRefs,
        originalFailureEvidenceRefs: input.evidenceRefs,
        policy,
        expiresAt: input.expiresAt,
        authorizationBasisHash: input.authorizationBasisHash,
        createdAt,
        sessionState: "REVIEW_REQUIRED",
      });
      const suite =
        input.subject.kind === "SUITE_BINDING_VERSION" ? input.subject.suiteBindingRef : undefined;
      await manager.query(
        `INSERT INTO qa_automation_quarantines(
        quarantine_id,workspace_id,project_id,subject_kind,suite_binding_id,suite_binding_version,suite_binding_content_hash,
        infrastructure_code,current_revision_id,current_revision_no,current_revision_hash,current_action,current_expires_at,
        resource_version,created_by_principal_id,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,'ACTIVATE',$11,1,$12,$13,$13)`,
        [
          quarantineId,
          scope.workspaceId,
          scope.projectId,
          input.subject.kind,
          suite?.id ?? null,
          suite?.version ?? null,
          suite?.contentHash ?? null,
          input.subject.kind === "INFRASTRUCTURE_CODE" ? input.subject.infrastructureCode : null,
          change.revision.quarantineRevisionId,
          change.revision.contentHash,
          change.revision.expiresAt,
          change.revision.actorPrincipalId,
          createdAt,
        ],
      );
      await insertRevision(manager, change.revision);
      await insertEvent(manager, change.event as never);
      return Object.freeze({
        created: true,
        value: projectQaAutomationQuarantine(change.quarantine, this.now()),
      });
    });
  }

  async lift(
    input: Readonly<{
      context: QaWorkspaceContext;
      quarantineId: string;
      idempotencyKey: string;
      expectedResourceVersion: number;
      reason: string;
      evidenceRefs: readonly string[];
      authorizationBasisHash: QaContentHash;
    }>,
  ): Promise<QaAutomationQuarantineProjection | undefined> {
    const revisionId = deterministicUuid(
      `qa-automation-quarantine-lift:${input.quarantineId}:${qaAggregateSnapshotHash(input.idempotencyKey as never)}`,
    );
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const scope = input.context.scope;
      if (scope.kind !== "PROJECT")
        throw new Error("QA_AUTOMATION_QUARANTINE_PROJECT_SCOPE_REQUIRED");
      const headerRow = (
        await rows(
          manager,
          "SELECT * FROM qa_automation_quarantines WHERE workspace_id=$1 AND project_id=$2 AND quarantine_id=$3 FOR UPDATE",
          [scope.workspaceId, scope.projectId, input.quarantineId],
        )
      )[0];
      if (!headerRow) return undefined;
      const current = quarantine(headerRow);
      const replayRow = (
        await rows(
          manager,
          "SELECT * FROM qa_automation_quarantine_revisions WHERE workspace_id=$1 AND project_id=$2 AND quarantine_revision_id=$3",
          [scope.workspaceId, scope.projectId, revisionId],
        )
      )[0];
      if (replayRow) {
        const replay = revision(replayRow);
        if (
          replay.action !== "LIFT" ||
          replay.reason !== input.reason.trim() ||
          JSON.stringify(replay.evidenceRefs) !==
            JSON.stringify([...new Set(input.evidenceRefs)].sort())
        ) {
          throw new Error("QA_AUTOMATION_QUARANTINE_IDEMPOTENCY_CONFLICT");
        }
        return projectQaAutomationQuarantine(current, this.now());
      }
      if (current.resourceVersion !== input.expectedResourceVersion)
        throw new Error("QA_AUTOMATION_QUARANTINE_CAS_CONFLICT");
      const previousRow = (
        await rows(
          manager,
          "SELECT * FROM qa_automation_quarantine_revisions WHERE workspace_id=$1 AND project_id=$2 AND quarantine_revision_id=$3",
          [scope.workspaceId, scope.projectId, current.currentRevisionId],
        )
      )[0];
      if (!previousRow) throw new Error("QA_AUTOMATION_QUARANTINE_HEAD_NOT_FOUND");
      const previous = revision(previousRow);
      await this.#assertOwner(manager, scope, previous.ownerPrincipalId);
      const change = reviseQaAutomationQuarantine({
        context: input.context,
        quarantine: current,
        previousRevision: previous,
        quarantineRevisionId: revisionId,
        action: "LIFT",
        ownerPrincipalId: previous.ownerPrincipalId,
        reason: input.reason,
        evidenceRefs: input.evidenceRefs,
        originalFailureEvidenceRefs: previous.evidenceRefs,
        policy: Object.freeze({
          policyRef: previous.policyRef,
          policyHash: previous.policyHash,
          maximumLifetimeSeconds: previous.maximumLifetimeSeconds,
          allowedSubjectKinds: Object.freeze([previous.subject.kind]),
        }),
        authorizationBasisHash: input.authorizationBasisHash,
        createdAt: this.now().toISOString(),
        expectedResourceVersion: input.expectedResourceVersion,
        sessionState: "REVIEW_REQUIRED",
      });
      await insertRevision(manager, change.revision);
      const updated = await rows(
        manager,
        `UPDATE qa_automation_quarantines
        SET current_revision_id=$4,current_revision_no=$5,current_revision_hash=$6,current_action=$7,current_expires_at=$8,
            resource_version=resource_version+1,updated_at=$9
        WHERE workspace_id=$1 AND project_id=$2 AND quarantine_id=$3 AND resource_version=$10 RETURNING *`,
        [
          scope.workspaceId,
          scope.projectId,
          input.quarantineId,
          change.revision.quarantineRevisionId,
          change.revision.revisionNo,
          change.revision.contentHash,
          change.revision.action,
          change.revision.expiresAt ?? null,
          change.revision.createdAt,
          input.expectedResourceVersion,
        ],
      );
      if (updated.length !== 1) throw new Error("QA_AUTOMATION_QUARANTINE_CAS_CONFLICT");
      await insertEvent(manager, change.event as never);
      return projectQaAutomationQuarantine(quarantine(updated[0]!), this.now());
    });
  }

  async #assertOwner(
    manager: EntityManager,
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    ownerPrincipalId: string,
  ): Promise<void> {
    const found = await rows(
      manager,
      `SELECT 1 FROM identities identity
      JOIN workspace_memberships membership ON membership.principal_id=identity.id AND membership.workspace_id=$2
        AND membership.state='ACTIVE' AND membership.revoked_at IS NULL
      JOIN project_entitlements entitlement ON entitlement.principal_id=identity.id AND entitlement.workspace_id=$2 AND entitlement.project_id=$3
        AND entitlement.effect='ALLOW' AND entitlement.revoked_at IS NULL
      WHERE identity.id=$1 AND identity.kind='HUMAN'`,
      [ownerPrincipalId, scope.workspaceId, scope.projectId],
    );
    if (found.length !== 1) throw new Error("QA_AUTOMATION_QUARANTINE_OWNER_DENIED");
  }

  async #assertAuthority(
    manager: EntityManager,
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    ownerPrincipalId: string,
    target: QaAutomationQuarantineSubject,
    policyRef: string,
    policyHash: QaContentHash,
  ): Promise<void> {
    await this.#assertOwner(manager, scope, ownerPrincipalId);
    const found =
      target.kind === "SUITE_BINDING_VERSION"
        ? await rows(
            manager,
            `SELECT 1 FROM qa_automation_suite_binding_versions
          WHERE workspace_id=$1 AND project_id=$2 AND suite_binding_id=$3 AND version=$4 AND content_hash=$5
            AND state='PUBLISHED' AND concat(quarantine_policy_ref->>'id','@',quarantine_policy_ref->>'version')=$6
            AND quarantine_policy_content_hash=$7`,
            [
              scope.workspaceId,
              scope.projectId,
              target.suiteBindingRef.id,
              target.suiteBindingRef.version,
              target.suiteBindingRef.contentHash,
              policyRef,
              policyHash,
            ],
          )
        : await rows(
            manager,
            `SELECT 1 FROM qa_automation_attempts
          WHERE workspace_id=$1 AND project_id=$2 AND quarantine_policy_ref=$3 AND quarantine_policy_content_hash=$4
          LIMIT 1`,
            [scope.workspaceId, scope.projectId, policyRef, policyHash],
          );
    if (found.length !== 1) throw new Error("QA_AUTOMATION_QUARANTINE_POLICY_REVOKED");
  }
}

function object(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException(code);
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new BadRequestException(`${code}:${unknown.sort().join(",")}`);
}

function quarantineSubject(value: unknown): QaAutomationQuarantineSubject {
  const candidate = object(value, "QA_AUTOMATION_QUARANTINE_SUBJECT_INVALID");
  if (candidate.kind === "INFRASTRUCTURE_CODE") {
    exactKeys(
      candidate,
      ["kind", "infrastructureCode"],
      "QA_AUTOMATION_QUARANTINE_SUBJECT_FIELD_FORBIDDEN",
    );
    return Object.freeze({
      kind: "INFRASTRUCTURE_CODE",
      infrastructureCode: String(candidate.infrastructureCode),
    });
  }
  if (candidate.kind === "SUITE_BINDING_VERSION") {
    exactKeys(
      candidate,
      ["kind", "suiteBindingRef"],
      "QA_AUTOMATION_QUARANTINE_SUBJECT_FIELD_FORBIDDEN",
    );
    const ref = object(candidate.suiteBindingRef, "QA_AUTOMATION_QUARANTINE_SUITE_REF_INVALID");
    exactKeys(
      ref,
      ["id", "version", "contentHash"],
      "QA_AUTOMATION_QUARANTINE_SUITE_REF_FIELD_FORBIDDEN",
    );
    return Object.freeze({
      kind: "SUITE_BINDING_VERSION",
      suiteBindingRef: Object.freeze({
        id: String(ref.id),
        version: Number(ref.version),
        contentHash: String(ref.contentHash) as QaContentHash,
      }),
    });
  }
  throw new BadRequestException("QA_AUTOMATION_QUARANTINE_SUBJECT_KIND_INVALID");
}

function requestKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{16,128}$/u.test(value))
    throw new BadRequestException("QA_AUTOMATION_QUARANTINE_IDEMPOTENCY_KEY_INVALID");
  return value;
}

function version(value: string | undefined): number {
  const match = /^"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_AUTOMATION_QUARANTINE_IF_MATCH_REQUIRED");
  return Number(match[1]);
}

function mapError(error: unknown): never {
  const code = error instanceof Error ? error.message : "QA_AUTOMATION_QUARANTINE_REQUEST_FAILED";
  if (/CONFLICT|SUBJECT_EXISTS|CAS/u.test(code)) throw new ConflictException(code);
  if (/OWNER_DENIED|POLICY_REVOKED|POLICY_DENIED/u.test(code)) throw new ForbiddenException(code);
  if (/INVALID|REQUIRED|FORBIDDEN/u.test(code)) throw new BadRequestException(code);
  throw error;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automation/quarantines")
@UseGuards(QaSessionGuard)
export class QaAutomationQuarantinesController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_AUTOMATION_QUARANTINES_API)
    private readonly quarantines: TypeOrmQaAutomationQuarantineApi,
  ) {}

  @Get()
  async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    return await this.quarantines.list(Object.freeze({ workspaceId, projectId }));
  }

  @Get(":quarantineId")
  async get(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("quarantineId") quarantineId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const value = await this.quarantines.get(
      Object.freeze({ workspaceId, projectId }),
      quarantineId,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATION_QUARANTINE_NOT_FOUND");
    response.setHeader("ETag", `"${value.resourceVersion}"`);
    return value;
  }

  @Get(":quarantineId/revisions")
  async revisions(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("quarantineId") quarantineId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const value = await this.quarantines.revisions(
      Object.freeze({ workspaceId, projectId }),
      quarantineId,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATION_QUARANTINE_NOT_FOUND");
    return value;
  }

  @Post()
  async activate(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const body = object(raw, "QA_AUTOMATION_QUARANTINE_BODY_INVALID");
    exactKeys(
      body,
      [
        "subject",
        "ownerPrincipalId",
        "reason",
        "evidenceRefs",
        "policyRef",
        "policyHash",
        "expiresAt",
      ],
      "QA_AUTOMATION_QUARANTINE_FIELD_FORBIDDEN",
    );
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.quarantine.manage",
    );
    assertQaAutomationHuman(authorization.actor);
    try {
      const result = await this.quarantines.activate({
        context: Object.freeze({
          actor: authorization.actor,
          scope: Object.freeze({ kind: "PROJECT", workspaceId, projectId }),
          correlationId: randomUUID(),
          causationId: randomUUID(),
          authorizationBasis: authorization.basis,
        }),
        idempotencyKey: requestKey(idempotencyKey),
        subject: quarantineSubject(body.subject),
        ownerPrincipalId: String(body.ownerPrincipalId),
        reason: String(body.reason),
        evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs.map(String) : [],
        policyRef: String(body.policyRef),
        policyHash: String(body.policyHash) as QaContentHash,
        expiresAt: String(body.expiresAt),
        authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
      });
      response.status(result.created ? 201 : 200);
      response.setHeader("ETag", `"${result.value.resourceVersion}"`);
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/qa/automation/quarantines/${result.value.quarantineId}`,
      );
      return result.value;
    } catch (error) {
      return mapError(error);
    }
  }

  @Post(":quarantineId/lift")
  async lift(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("quarantineId") quarantineId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const body = object(raw, "QA_AUTOMATION_QUARANTINE_LIFT_BODY_INVALID");
    exactKeys(body, ["reason", "evidenceRefs"], "QA_AUTOMATION_QUARANTINE_LIFT_FIELD_FORBIDDEN");
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.quarantine.manage",
    );
    assertQaAutomationHuman(authorization.actor);
    try {
      const value = await this.quarantines.lift({
        context: Object.freeze({
          actor: authorization.actor,
          scope: Object.freeze({ kind: "PROJECT", workspaceId, projectId }),
          correlationId: randomUUID(),
          causationId: randomUUID(),
          authorizationBasis: authorization.basis,
        }),
        quarantineId,
        idempotencyKey: requestKey(idempotencyKey),
        expectedResourceVersion: version(ifMatch),
        reason: String(body.reason),
        evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs.map(String) : [],
        authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
      });
      if (!value) throw new NotFoundException("QA_AUTOMATION_QUARANTINE_NOT_FOUND");
      response.setHeader("ETag", `"${value.resourceVersion}"`);
      return value;
    } catch (error) {
      return mapError(error);
    }
  }
}
