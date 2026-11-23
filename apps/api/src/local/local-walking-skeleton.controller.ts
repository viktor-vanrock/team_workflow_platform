import { createHash, randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import { defaultClassificationCatalog, DenyByDefaultAuthorizationPolicy } from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";
import { assertNoAuthoritativeClientFields } from "@awp/platform-runtime-nest";
import {
  assertEffectEndpointAllowed,
  DeterministicModelGateway,
  loadEnvironment,
  localPersonaCatalog,
} from "@awp/runtime-composition";

import { LOCAL_PERSONA_DATA_SOURCE } from "./local-persona.controller.ts";
import { LocalSessionGuard, type LocalSessionRequest } from "./local-session.guard.ts";

interface DurablePersonaContext {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly workspaceKey: string;
  readonly projectKey?: string;
}

@Controller("local/walking-skeleton")
@UseGuards(LocalSessionGuard)
export class LocalWalkingSkeletonController {
  readonly #environment = loadEnvironment();
  constructor(@Inject(LOCAL_PERSONA_DATA_SOURCE) private readonly dataSource: DataSource) {}

  async #context(personaKey: string, permission: string): Promise<DurablePersonaContext> {
    const persona = localPersonaCatalog.resolve(personaKey);
    const rows = (await this.dataSource.query(
      `
      SELECT i.id AS principal_id,w.id AS workspace_id,w.key AS workspace_key,p.id AS project_id,p.key AS project_key
      FROM identities i JOIN workspace_memberships wm ON wm.principal_id=i.id AND wm.state='ACTIVE' AND wm.revoked_at IS NULL AND wm.valid_from<=clock_timestamp() AND (wm.valid_until IS NULL OR wm.valid_until>clock_timestamp())
      JOIN workspaces w ON w.id=wm.workspace_id AND w.state='ACTIVE' AND w.key=$4
      LEFT JOIN projects p ON p.workspace_id=w.id AND p.key=$2
      WHERE i.issuer=$1 AND i.subject=$3
    `,
      [
        this.#environment.identityIssuer,
        persona.projectKey ?? null,
        persona.subject,
        persona.workspaceKey,
      ],
    )) as readonly Record<string, unknown>[];
    const row = rows[0];
    if (!row) throw new ForbiddenException("LOCAL_PERSONA_NOT_SEEDED");
    const scope = Object.freeze({
      principalId: String(row.principal_id),
      workspaceId: String(row.workspace_id),
      workspaceKey: String(row.workspace_key),
      ...(row.project_id
        ? { projectId: String(row.project_id), projectKey: String(row.project_key) }
        : {}),
    });
    await this.#authorize(scope, personaKey, permission);
    return scope;
  }
  async #authorize(
    scope: DurablePersonaContext,
    personaKey: string,
    permission: string,
    manager: DataSource["manager"] = this.dataSource.manager,
    classification?: string,
  ) {
    if (!scope.projectId) throw new ForbiddenException("PROJECT_SCOPE_REQUIRED");
    await manager.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [scope.workspaceId]);
    const persona = localPersonaCatalog.resolve(personaKey);
    const resource = {
      kind: "PROJECT" as const,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    };
    const repository = new TypeOrmScopedAccessRepository(manager),
      at = new Date();
    const project = await repository.getProject(resource);
    if (!project || project.state !== "ACTIVE") throw new ForbiddenException("LOCAL_SCOPE_DENIED");
    const actor =
      persona.kind === "HUMAN"
        ? {
            kind: "HUMAN" as const,
            principalId: scope.principalId,
            issuer: this.#environment.identityIssuer,
            subject: persona.subject,
          }
        : { kind: "SERVICE" as const, principalId: scope.principalId, serviceKey: persona.key };
    const decision = new DenyByDefaultAuthorizationPolicy().decide({
      context: {
        actor,
        scope: resource,
        correlationId: "local-walking",
        causationId: "local-walking",
      },
      permission,
      resourceClassification: classification
        ? defaultClassificationCatalog.reference(classification)
        : project.classification,
      facts: await repository.authorizationFacts(resource, scope.principalId, at),
      at,
    });
    if (!decision.allowed) throw new ForbiddenException("LOCAL_PERMISSION_DENIED");
  }

  @Get()
  async overview(@Req() request: LocalSessionRequest) {
    const personaKey = request.localPersonaKey!;
    const scope = await this.#context(personaKey, "work-item.read");
    const workItems = scope.projectId
      ? ((await this.dataSource.query(
          `SELECT w.id,w.state,w.classification_key,d.sample_name,d.message,d.row_version FROM work_items w LEFT JOIN dummy_requests d ON d.workspace_id=w.workspace_id AND d.project_id=w.project_id AND d.work_item_id=w.id WHERE w.workspace_id=$1 AND w.project_id=$2 ORDER BY w.created_at DESC LIMIT 20`,
          [scope.workspaceId, scope.projectId],
        )) as readonly Record<string, unknown>[])
      : [];
    const commands = scope.projectId
      ? ((await this.dataSource.query(
          `SELECT id,state,result,correlation_id,effect_idempotency_key,created_at FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 10`,
          [scope.workspaceId, scope.projectId],
        )) as readonly Record<string, unknown>[])
      : [];
    const approvals = scope.projectId
      ? ((await this.dataSource.query(
          `SELECT id,action_kind,action_id,decision_state,effect_authorization_state,expires_at,row_version FROM approvals WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 10`,
          [scope.workspaceId, scope.projectId],
        )) as readonly Record<string, unknown>[])
      : [];
    const artifacts = scope.projectId
      ? ((await this.dataSource.query(
          `SELECT id,file_name,media_type,size_bytes,checksum,classification_key,availability,expires_at FROM artifact_references WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at`,
          [scope.workspaceId, scope.projectId],
        )) as readonly Record<string, unknown>[])
      : [];
    const visible = async (rows: readonly Record<string, unknown>[], permission: string) => {
      const result = [];
      for (const row of rows) {
        try {
          await this.#authorize(
            scope,
            personaKey,
            permission,
            this.dataSource.manager,
            typeof row.classification_key === "string" ? row.classification_key : undefined,
          );
          result.push(row);
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
        }
      }
      return result;
    };
    const model = await new DeterministicModelGateway({
      ...(this.#environment.modelProvider ? { provider: this.#environment.modelProvider } : {}),
    }).complete({ prompt: "local walking skeleton ready", correlationId: randomUUID() });
    return {
      profile: "local",
      persona: personaKey,
      context: scope,
      extension: "dummy.request@1.0.0",
      model,
      workItems: await visible(workItems, "work-item.read"),
      commands: await visible(commands, "command.execute"),
      approvals: await visible(approvals, "approval.decide"),
      artifacts: await visible(artifacts, "artifact.read"),
    };
  }

  @Post("dummy")
  async submitDummy(
    @Req() request: LocalSessionRequest,
    @Body() body: Readonly<{ sampleName?: string; message?: string }>,
  ) {
    assertNoAuthoritativeClientFields(body);
    const sampleName = body.sampleName?.trim();
    const message = body.message?.trim();
    if (
      Object.keys(body).some((key) => !["sampleName", "message"].includes(key)) ||
      !sampleName ||
      !message
    )
      throw new Error("DUMMY_INTAKE_INVALID");
    const personaKey = request.localPersonaKey!;
    const scope = await this.#context(personaKey, "work-item.create");
    if (!scope.projectId) throw new ForbiddenException("PROJECT_SCOPE_REQUIRED");
    const workItemId = randomUUID();
    const requestId = randomUUID();
    await this.dataSource.transaction(async (manager) => {
      await this.#authorize(scope, personaKey, "work-item.create", manager);
      const definitions = (await manager.query(
        "SELECT id FROM work_type_definitions WHERE work_type_key='dummy.request' AND definition_version='1.0.0'",
      )) as readonly { id: string }[];
      const definitionId = definitions[0]?.id;
      if (!definitionId) throw new Error("DUMMY_WORK_TYPE_NOT_REGISTERED");
      await manager.query(
        "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'OPEN','INTERNAL',clock_timestamp())",
        [workItemId, scope.workspaceId, scope.projectId, definitionId, scope.principalId],
      );
      await manager.query(
        "INSERT INTO dummy_requests(id,workspace_id,project_id,work_item_id,sample_name,message,history,created_at) VALUES($1,$2,$3,$4,$5,$6,'[]',clock_timestamp())",
        [requestId, scope.workspaceId, scope.projectId, workItemId, sampleName, message],
      );
    });
    return { id: workItemId, extensionId: requestId, state: "OPEN", rowVersion: 1 };
  }

  @Post("commands")
  async command(
    @Req() request: LocalSessionRequest,
    @Body()
    body: Readonly<{
      recordKey?: string;
      message?: string;
      clientRequestKey?: string;
      approvalRequired?: boolean;
    }>,
  ) {
    assertNoAuthoritativeClientFields(body);
    if (
      Object.keys(body).some(
        (key) => !["recordKey", "message", "clientRequestKey", "approvalRequired"].includes(key),
      ) ||
      !body.recordKey ||
      !body.message ||
      !body.clientRequestKey
    )
      throw new Error("LOCAL_COMMAND_INVALID");
    const personaKey = request.localPersonaKey!;
    const persona = localPersonaCatalog.resolve(personaKey);
    const scope = await this.#context(personaKey, "command.execute");
    if (!scope.projectId) throw new ForbiddenException("PROJECT_SCOPE_REQUIRED");
    const effectKey = `local:${scope.workspaceId}:${scope.projectId}:${body.clientRequestKey}`;
    const existing = (await this.dataSource.query(
      "SELECT id,state,result,correlation_id FROM connector_commands WHERE effect_idempotency_key=$1",
      [effectKey],
    )) as readonly Record<string, unknown>[];
    if (existing[0])
      return {
        ...existing[0],
        replayed: true,
        effectCount: existing[0].state === "CONFIRMED" ? 1 : 0,
      };
    const commandId = randomUUID();
    const correlationId = randomUUID();
    const causationId = randomUUID();
    const target = { id: body.recordKey };
    const payload = { message: body.message };
    if (body.approvalRequired) {
      const approvalId = randomUUID();
      await this.dataSource.transaction(async (manager) => {
        await this.#authorize(scope, personaKey, "command.execute", manager);
        await manager.query(
          "INSERT INTO connector_commands(id,workspace_id,project_id,actor,capability_key,capability_version,operation,target,payload,binding_ref,profile_ref,effect_idempotency_key,state,result,correlation_id,causation_id,created_at) VALUES($1,$2,$3,$4,'sample.record','1.0.0','record.publish',$5,$6,$7,$8,$9,'AWAITING_APPROVAL',NULL,$10,$11,clock_timestamp())",
          [
            commandId,
            scope.workspaceId,
            scope.projectId,
            JSON.stringify({ kind: persona.kind, principalId: scope.principalId }),
            JSON.stringify(target),
            JSON.stringify(payload),
            JSON.stringify({ id: "72000000-0000-4000-8000-000000000004", version: 1 }),
            JSON.stringify({ id: "72000000-0000-4000-8000-000000000003", version: 1 }),
            effectKey,
            correlationId,
            causationId,
          ],
        );
        const subject = {
          actionKind: "EXTERNAL_COMMAND",
          actionId: commandId,
          capabilityKey: "sample.record",
          capabilityVersion: "1.0.0",
          operation: "record.publish",
          target,
          payload,
          effectIdempotencyKey: effectKey,
        };
        const subjectHash = `sha256:${createHash("sha256").update(JSON.stringify(subject)).digest("hex")}`;
        await manager.query(
          "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,expires_at,created_at) VALUES($1,$2,$3,'EXTERNAL_COMMAND',$4,$5,$6,'PENDING','PENDING',$7,clock_timestamp()+interval '15 minutes',clock_timestamp())",
          [
            approvalId,
            scope.workspaceId,
            scope.projectId,
            commandId,
            JSON.stringify(subject),
            subjectHash,
            scope.principalId,
          ],
        );
        await this.#audit(
          manager,
          scope,
          { kind: persona.kind, principalId: scope.principalId },
          "sample.record.intent",
          "ACCEPTED",
          "APPROVAL_REQUIRED",
          correlationId,
          causationId,
          { commandId, approvalId, effectIdempotencyKey: effectKey },
        );
      });
      return {
        id: commandId,
        approvalId,
        state: "AWAITING_APPROVAL",
        correlationId,
        effectCount: 0,
      };
    }
    await this.dataSource.transaction(async (manager) => {
      await this.#authorize(scope, personaKey, "command.execute", manager);
      await manager.query(
        "INSERT INTO connector_commands(id,workspace_id,project_id,actor,capability_key,capability_version,operation,target,payload,binding_ref,profile_ref,effect_idempotency_key,state,result,correlation_id,causation_id,created_at) VALUES($1,$2,$3,$4,'sample.record','1.0.0','record.publish',$5,$6,$7,$8,$9,'DISPATCHED',NULL,$10,$11,clock_timestamp())",
        [
          commandId,
          scope.workspaceId,
          scope.projectId,
          JSON.stringify({ kind: persona.kind, principalId: scope.principalId }),
          JSON.stringify(target),
          JSON.stringify(payload),
          JSON.stringify({ id: "72000000-0000-4000-8000-000000000004", version: 1 }),
          JSON.stringify({ id: "72000000-0000-4000-8000-000000000003", version: 1 }),
          effectKey,
          correlationId,
          causationId,
        ],
      );
      await this.#audit(
        manager,
        scope,
        { kind: persona.kind, principalId: scope.principalId },
        "sample.record.intent",
        "ACCEPTED",
        "AUTHORIZED_EFFECT_INTENT",
        correlationId,
        causationId,
        { commandId, effectIdempotencyKey: effectKey },
      );
    });
    const result = await this.#publish(effectKey, correlationId, target, payload);
    await this.dataSource.transaction(async (manager) => {
      const updated = (await manager.query(
        "UPDATE connector_commands SET state='CONFIRMED',result=$1,row_version=row_version+1 WHERE id=$2 AND workspace_id=$3 AND project_id=$4 AND state='DISPATCHED' RETURNING id",
        [JSON.stringify(result), commandId, scope.workspaceId, scope.projectId],
      )) as readonly unknown[];
      const changed = Array.isArray(updated[0]) ? updated[0] : updated;
      if (changed.length !== 1) throw new Error("LOCAL_COMMAND_CONFIRMATION_CONFLICT");
      await this.#audit(
        manager,
        scope,
        { kind: persona.kind, principalId: scope.principalId },
        "sample.record.result",
        "SUCCEEDED",
        "PROVIDER_EFFECT_CONFIRMED",
        correlationId,
        causationId,
        {
          commandId,
          effectIdempotencyKey: effectKey,
          resultHash: `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`,
        },
      );
    });
    return { id: commandId, state: "CONFIRMED", correlationId, result, effectCount: 1 };
  }

  @Post("approvals/:id/approve")
  async approve(@Req() request: LocalSessionRequest, @Param("id") approvalId: string) {
    const personaKey = request.localPersonaKey!;
    const persona = localPersonaCatalog.resolve(personaKey);
    const scope = await this.#context(personaKey, "approval.decide");
    if (!scope.projectId) throw new ForbiddenException("PROJECT_SCOPE_REQUIRED");
    const rows = (await this.dataSource.query(
      "SELECT a.*,c.actor AS command_actor,c.target,c.payload,c.effect_idempotency_key,c.correlation_id,c.causation_id FROM approvals a JOIN connector_commands c ON c.id=a.action_id AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id WHERE a.id=$1 AND a.workspace_id=$2 AND a.project_id=$3",
      [approvalId, scope.workspaceId, scope.projectId],
    )) as readonly Record<string, unknown>[];
    const approval = rows[0];
    if (!approval || approval.decision_state !== "PENDING")
      throw new ForbiddenException("APPROVAL_NOT_PENDING");
    if ((approval.command_actor as { principalId?: string })?.principalId === scope.principalId)
      throw new ForbiddenException("APPROVAL_SELF_APPROVAL_FORBIDDEN");
    const effectKey = String(approval.effect_idempotency_key),
      correlationId = String(approval.correlation_id),
      causationId = String(approval.causation_id ?? correlationId);
    await this.dataSource.transaction(async (manager) => {
      await this.#authorize(scope, personaKey, "approval.decide", manager);
      await manager.query(
        "UPDATE approvals SET decision_state='APPROVED',effect_authorization_state='CONSUMED',approver_id=$1,row_version=row_version+1 WHERE id=$2 AND decision_state='PENDING'",
        [scope.principalId, approvalId],
      );
      await manager.query(
        "UPDATE connector_commands SET state='DISPATCHED',row_version=row_version+1 WHERE id=$1 AND state='AWAITING_APPROVAL'",
        [approval.action_id],
      );
      await this.#audit(
        manager,
        scope,
        { kind: persona.kind, principalId: scope.principalId },
        "sample.record.approve",
        "ACCEPTED",
        "EXACT_APPROVAL_CONSUMED",
        correlationId,
        causationId,
        { commandId: approval.action_id, approvalId, effectIdempotencyKey: effectKey },
      );
    });
    const result = await this.#publish(
      effectKey,
      correlationId,
      approval.target as { id: string },
      approval.payload as { message: string },
    );
    await this.dataSource.transaction(async (manager) => {
      const updated = (await manager.query(
        "UPDATE connector_commands SET state='CONFIRMED',result=$1,row_version=row_version+1 WHERE id=$2 AND state='DISPATCHED' RETURNING id",
        [JSON.stringify(result), approval.action_id],
      )) as readonly unknown[];
      const changed = Array.isArray(updated[0]) ? updated[0] : updated;
      if (changed.length !== 1) throw new Error("LOCAL_COMMAND_CONFIRMATION_CONFLICT");
      await this.#audit(
        manager,
        scope,
        { kind: persona.kind, principalId: scope.principalId },
        "sample.record.result",
        "SUCCEEDED",
        "PROVIDER_EFFECT_CONFIRMED",
        correlationId,
        causationId,
        {
          commandId: approval.action_id,
          approvalId,
          effectIdempotencyKey: effectKey,
          resultHash: `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`,
        },
      );
    });
    return {
      approvalId,
      commandId: approval.action_id,
      state: "CONFIRMED",
      effectCount: 1,
      result,
    };
  }

  async #publish(
    effectKey: string,
    correlationId: string,
    target: Readonly<{ id: string }>,
    payload: Readonly<{ message: string }>,
  ): Promise<unknown> {
    assertEffectEndpointAllowed("local", this.#environment.mockHubUrl!);
    const response = await fetch(`${this.#environment.mockHubUrl}/mock/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        effectIdempotencyKey: effectKey,
        correlationId,
        target,
        payload,
        expectedExternalState: { mode: "MAY_EXIST" },
      }),
    });
    if (!response.ok) throw new Error(`MOCK_HUB_PUBLISH_FAILED:${response.status}`);
    return await response.json();
  }

  async #audit(
    manager: Pick<DataSource["manager"], "query">,
    scope: DurablePersonaContext,
    actor: Readonly<{ kind: string; principalId: string }>,
    action: string,
    outcome: string,
    reasonCode: string,
    correlationId: string,
    causationId: string,
    values: Readonly<Record<string, unknown>>,
  ) {
    if (!scope.projectId) throw new Error("PROJECT_SCOPE_REQUIRED");
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,$8,$9,$10,'INTERNAL',$11)",
      [
        randomUUID(),
        scope.workspaceId,
        scope.projectId,
        actor,
        action,
        outcome,
        reasonCode,
        correlationId,
        causationId,
        { kind: "PROJECT", source: "local-persona", principalId: actor.principalId },
        { values, versionRefs: [] },
      ],
    );
  }
}
