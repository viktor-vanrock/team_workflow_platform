import type { DataSource } from "typeorm";

import { qaAggregateSnapshotHash, type QaRequestInputRevision } from "@awp/competency-qa/node";
import {
  type ConnectorCommand,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
} from "@awp/platform-core";
import {
  TypeOrmIdentityRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

export async function currentQaRequesterEntitlement(
  source: DataSource,
  input: QaRequestInputRevision,
) {
  const actor = input.originalRequesterRef;
  const identity = await new TypeOrmIdentityRepository(source).findByVerifiedSubject(
    actor.issuer,
    actor.subject,
  );
  if (identity?.kind !== "HUMAN" || identity.id !== actor.principalId)
    return {
      active: false,
      basisHash: qaAggregateSnapshotHash({ reason: "REQUESTER_IDENTITY_INACTIVE" }),
    };
  const scope = {
    kind: "PROJECT" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  };
  const access = new TypeOrmScopedAccessRepository(source);
  const at = new Date();
  const decision = new DenyByDefaultAuthorizationPolicy().decide({
    context: { actor, scope, correlationId: input.correlationId, causationId: input.correlationId },
    permission: "work-item.read",
    resourceClassification: defaultClassificationCatalog.reference(input.dataClassificationKey),
    facts: await access.authorizationFacts(scope, actor.principalId, at),
    at,
    operationClass: "READ",
  });
  return {
    active: decision.allowed,
    basisHash: qaAggregateSnapshotHash((decision.basis ?? { reason: decision.reason }) as never),
  };
}

export async function assertCurrentQaReadinessInitiator(
  source: DataSource,
  command: ConnectorCommand,
): Promise<void> {
  const denied = () => new Error("QA_READINESS_COMMAND_STALE");
  if (command.actor.kind !== "HUMAN") throw denied();
  const identity = await new TypeOrmIdentityRepository(source).findByVerifiedSubject(
    command.actor.issuer,
    command.actor.subject,
  );
  if (identity?.kind !== "HUMAN" || identity.id !== command.actor.principalId) throw denied();
  const scope = {
    kind: "PROJECT" as const,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
  };
  const access = new TypeOrmScopedAccessRepository(source);
  const workspace = await access.getWorkspace({
    kind: "WORKSPACE",
    workspaceId: scope.workspaceId,
  });
  const project = await access.getProject(scope);
  if (workspace?.state !== "ACTIVE" || project?.state !== "ACTIVE") throw denied();
  const at = new Date();
  const facts = await access.authorizationFacts(scope, command.actor.principalId, at);
  const policy = new DenyByDefaultAuthorizationPolicy();
  for (const permission of ["qa.readiness.confirm", "command.execute", "integration.use"]) {
    const decision = policy.decide({
      context: {
        actor: command.actor,
        scope,
        correlationId: command.correlationId,
        causationId: command.causationId,
      },
      permission,
      resourceClassification: defaultClassificationCatalog.reference(command.dataClassificationKey),
      facts,
      at,
      operationClass: "EFFECT",
      projectOperationalState: "ACTIVE",
    });
    if (!decision.allowed) throw denied();
  }
}
