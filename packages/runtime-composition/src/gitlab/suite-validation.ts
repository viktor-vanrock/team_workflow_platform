import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import type {
  AutomationSuiteValidationCommandPort,
  QaAutomationSuiteVersion,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ConnectorCommand } from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

export const qaAutomationSuiteValidationCapabilityKey = "qa.automation-suite-validation" as const;
export const qaAutomationSuiteValidationOperation = "suite.validate" as const;

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function exactVersionTarget(version: QaAutomationSuiteVersion) {
  return Object.freeze({
    kind: "QA_AUTOMATION_SUITE_VERSION" as const,
    suiteBindingId: version.suiteBindingId,
    suiteBindingVersionId: version.id,
    version: version.version,
    contentHash: version.contentHash,
  });
}

export class TypeOrmAutomationSuiteValidationCommandQueue implements AutomationSuiteValidationCommandPort {
  constructor(private readonly source: DataSource) {}

  async enqueue(
    input: Parameters<AutomationSuiteValidationCommandPort["enqueue"]>[0],
  ): Promise<Readonly<{ commandId: string; replayed: boolean }>> {
    if (
      input.version.state !== "DRAFT" ||
      input.actor.kind !== "HUMAN" ||
      input.requestKey.length < 8 ||
      input.requestKey.length > 200
    ) {
      throw new Error("QA_AUTOMATION_SUITE_VALIDATION_REQUEST_INVALID");
    }
    if (
      input.version.workspaceId !== input.scope.workspaceId ||
      input.version.projectId !== input.scope.projectId
    ) {
      throw new Error("QA_AUTOMATION_SUITE_VALIDATION_SCOPE_MISMATCH");
    }
    const requestKeyHash = sha256(input.requestKey);
    const identity = `${input.scope.workspaceId}:${input.scope.projectId}:${input.version.id}:${input.version.contentHash}:${requestKeyHash}`;
    const commandId = deterministicUuid(`qa-suite-validation-command:${identity}`);
    const effectIdempotencyKey = `qa-suite-validation:${sha256(identity)}`;
    const target = exactVersionTarget(input.version);
    const payload = Object.freeze({
      requestedAt: input.requestedAt,
      suiteContentHash: input.version.contentHash,
    });
    const at = new Date(input.requestedAt);
    if (Number.isNaN(at.getTime())) throw new Error("QA_AUTOMATION_SUITE_VALIDATION_TIME_INVALID");
    const command: ConnectorCommand = Object.freeze({
      id: commandId,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      actor: input.actor,
      commandType: "qa.automation-suite.validate",
      capability: Object.freeze({
        key: qaAutomationSuiteValidationCapabilityKey,
        exactContractVersion: "1.0.0",
        operation: qaAutomationSuiteValidationOperation,
        logicalRole: "SUITE_VALIDATION",
      }),
      target,
      targetHash: sha256(target as unknown as JsonValue),
      payload,
      payloadHash: sha256(payload as unknown as JsonValue),
      expectedExternalState: Object.freeze({
        validationReport: "APPEND_ONLY",
        suiteState: "DRAFT",
      }),
      bindingRef: input.bindingRef,
      profileRef: input.profileRef,
      clientRequestKey: requestKeyHash,
      effectIdempotencyKey,
      dataClassificationKey: "INTERNAL",
      initialAuthorizationBasis: input.authorizationBasis,
      initialAuthorizationBasisHash: input.authorizationBasisHash,
      correlationId: input.correlationId,
      causationId: input.causationId,
      source: Object.freeze({}),
      recoveryPolicy: "SAFE_RETRY",
      status: "QUEUED",
      effectAuthorizationStatus: "NOT_REQUIRED",
      outboxStatus: "READY",
      attemptCount: 0,
      createdAt: at,
      updatedAt: at,
      rowVersion: 1,
    });
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const replay = (await manager.query(
        "SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND effect_idempotency_key=$3",
        [input.scope.workspaceId, input.scope.projectId, effectIdempotencyKey],
      )) as readonly { id: string }[];
      if (replay[0]) return Object.freeze({ commandId: replay[0].id, replayed: true });
      await new TypeOrmCommandRepository(this.source).insert(command, manager);
      await manager.query(
        `
INSERT INTO command_outbox(id,command_id,workspace_id,project_id,state,available_at,attempts,envelope_hash,created_at)
VALUES($1,$2,$3,$4,'READY',$5,0,$6,$5)`,
        [
          deterministicUuid(`qa-suite-validation-outbox:${identity}`),
          command.id,
          command.workspaceId,
          command.projectId,
          at,
          sha256({
            commandId: command.id,
            workspaceId: command.workspaceId,
            projectId: command.projectId,
          } as JsonValue),
        ],
      );
      return Object.freeze({ commandId, replayed: false });
    });
  }
}
