import { randomUUID } from "node:crypto";

import { type JsonValue, sha256 } from "../../packages/platform-contracts/src/index.ts";
import {
  type ConnectorCommand,
  createExactApproval,
  decideApproval,
  InMemoryDurableCommandStore,
} from "../../packages/platform-core/src/index.ts";
import {
  type createPlatformDataSource,
  TypeOrmApprovalRepository,
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type DeadLetterContext,
  type DeadLetterPolicy,
  type OriginalReplayGuard,
  type OriginalReplayProof,
  PilotDeadLetterService,
} from "../../packages/runtime-composition/src/pilot/dead-letter-service.ts";

type DataSource = ReturnType<typeof createPlatformDataSource>;

export async function seedDeadLetterFixture(
  source: DataSource,
  options: Readonly<{
    approval?: boolean;
    invoked?: boolean;
    code?: string;
    workspaceId?: string;
  }> = {},
) {
  const workspaceId = options.workspaceId ?? randomUUID(),
    projectId = randomUUID(),
    operator = randomUUID(),
    initiator = randomUUID(),
    approver = randomUUID();
  const createdAt = new Date("2026-09-04T12:00:00Z");
  const state = {
    now: new Date(createdAt.getTime() + 1000),
    operatorAllowed: true,
    originalAllowed: true,
    approverAllowed: true,
    corruptPins: false,
    gateCalls: 0,
    revokeOnCall: 0,
  };
  await source.query(
    "INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'Dead letter fixture','ACTIVE') ON CONFLICT(id) DO NOTHING",
    [workspaceId, workspaceId],
  );
  await source.query(
    "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,$3,'Dead letter fixture','ACTIVE','INTERNAL')",
    [projectId, workspaceId, projectId],
  );
  for (const id of [operator, initiator, approver])
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'https://fixture.invalid',$2,'HUMAN','Fixture')",
      [id, id],
    );
  const sample = InMemoryDurableCommandStore.readyFixture().command();
  const basis = {
    ...sample.initialAuthorizationBasis,
    roleAssignmentRefs: [{ id: randomUUID(), version: 1 }],
    entitlementRefs: [{ id: randomUUID(), version: 1 }],
  };
  const target = { id: "original-target" },
    payload = { privateText: "PRIVATE_PROVIDER_PAYLOAD_CANARY" };
  let command: ConnectorCommand = {
    ...sample,
    id: randomUUID(),
    workspaceId,
    projectId,
    actor: {
      kind: "HUMAN",
      principalId: initiator,
      issuer: "https://fixture.invalid",
      subject: initiator,
    },
    initialAuthorizationBasis: basis,
    bindingRef: { id: randomUUID(), version: 1 },
    profileRef: { id: randomUUID(), version: 1 },
    target,
    targetHash: sha256(target),
    payload,
    payloadHash: sha256(payload),
    initialAuthorizationBasisHash: sha256(basis as unknown as JsonValue),
    correlationId: randomUUID(),
    causationId: randomUUID(),
    effectIdempotencyKey: randomUUID(),
    status: "FAILED",
    outboxStatus: "DEAD",
    terminalResult: { outcome: "FAILED", code: options.code ?? "JIRA_NETWORK_ERROR" },
    createdAt,
    updatedAt: state.now,
    recoveryPolicy: "LOOKUP_REQUIRED",
  };
  if (options.invoked)
    command = {
      ...command,
      effectInvocationStartedAt: state.now,
      effectGateDecision: "ALLOWED",
      effectGateEvaluatedAt: state.now,
      effectAuthorizationBasis: basis,
      effectAuthorizationBasisHash: command.initialAuthorizationBasisHash,
      attemptCount: 1,
    };
  if (options.approval) {
    const raw = createExactApproval({
      id: randomUUID(),
      workspaceId,
      projectId,
      initiatorId: initiator,
      initiator: command.actor,
      action: {
        actionKind: "EXTERNAL_COMMAND",
        actionId: command.id,
        commandType: command.commandType,
        capabilityKey: command.capability.key,
        capabilityVersion: command.capability.exactContractVersion,
        operation: command.capability.operation,
      },
      target,
      targetHash: command.targetHash,
      payloadHash: command.payloadHash,
      expectedState: command.expectedExternalState,
      bindingRef: command.bindingRef,
      profileRefs: [command.profileRef],
      requiredPermission: "record.publish",
      separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
      effectIdempotencyKey: command.effectIdempotencyKey,
      expiresAt: new Date(createdAt.getTime() + 60000),
      createdAt,
    });
    const approval = {
      ...decideApproval(raw, {
        approverId: approver,
        approverRole: "Operator",
        authorizationBasisHash: command.initialAuthorizationBasisHash,
        now: state.now,
      }),
      effectAuthorizationStatus: "CONSUMED" as const,
      consumedAt: state.now,
    };
    await new TypeOrmApprovalRepository(source).insert(approval);
    command = { ...command, approvalId: approval.id, effectAuthorizationStatus: "CONSUMED" };
  }
  await new TypeOrmCommandRepository(source).insert(command);
  const outboxId = randomUUID();
  await new TypeOrmCommandOutboxRepository(source).insert({
    id: outboxId,
    commandId: command.id,
    workspaceId,
    projectId,
    state: "DEAD",
    availableAt: state.now,
    attempts: command.attemptCount,
    envelopeHash: sha256({ commandId: command.id }),
    createdAt,
  });
  const ref = (id: string = randomUUID()) => ({
    id,
    version: 1,
    contentHash: sha256({ fixture: id }),
  });
  const policyBody = {
    workspaceId,
    projectId,
    ownerRef: operator,
    maximumAgeMs: 120000,
    maximumReplays: 2,
  };
  const policy: DeadLetterPolicy = {
    ...policyBody,
    ref: { ...ref(), contentHash: sha256(policyBody) },
  };
  const proof: OriginalReplayProof = {
    reportRef: ref(),
    fenceRef: ref(),
    bindingRef: { ...ref(command.bindingRef.id), version: command.bindingRef.version },
    profileRef: { ...ref(command.profileRef.id), version: command.profileRef.version },
    expiresAt: new Date(createdAt.getTime() + 60000).toISOString(),
  };
  const guard: OriginalReplayGuard = {
    check: async () => {
      state.gateCalls++;
      if (!state.originalAllowed || !state.approverAllowed)
        throw new Error("FIXTURE_ORIGINAL_AUTHORITY_REVOKED");
      return {
        ...proof,
        ...(state.corruptPins ? { bindingRef: { ...proof.bindingRef, version: 2 } } : {}),
      };
    },
  };
  let authorizations = 0;
  const context: DeadLetterContext = {
    workspaceId,
    projectId,
    authorize: async () => {
      if (++authorizations === state.revokeOnCall) state.operatorAllowed = false;
      if (!state.operatorAllowed) throw new Error("FIXTURE_OPERATOR_REVOKED");
      return {
        actor: {
          kind: "HUMAN",
          principalId: operator,
          issuer: "https://fixture.invalid",
          subject: operator,
        },
        basis,
        classificationCeiling: "CONFIDENTIAL",
        scope: { kind: "PROJECT", workspaceId, projectId },
      };
    },
  };
  const service = () => new PilotDeadLetterService(source, [policy], guard, () => state.now);
  const current = async () =>
    (await new TypeOrmCommandRepository(source).get(workspaceId, projectId, command.id))!;
  const input = async () => ({
    commandId: command.id,
    recordRef: await service().capture(context, command.id),
    expectedRowVersion: (await current()).rowVersion,
    requestKey: randomUUID(),
    reason: "DEPENDENCY_REPAIRED" as const,
  });
  return {
    source,
    state,
    context,
    policy,
    proof,
    guard,
    command,
    outboxId,
    operator,
    service,
    current,
    input,
  };
}
