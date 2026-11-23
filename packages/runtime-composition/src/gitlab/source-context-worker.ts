import { createHash } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import type {
  SourceContextReadPort,
  SourceContextReadRequest,
  SourceContextReadResult,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ConnectorCommand } from "@awp/platform-core";
import {
  TypeOrmCommandDeliveryStore,
  TypeOrmCommandRepository,
} from "@awp/platform-persistence-typeorm";

export const gitLabSourceRefreshCapabilityKey = "source-context.read" as const;

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export interface GitLabSourceRefreshAuthority {
  materialize(command: ConnectorCommand): Promise<
    Readonly<{
      port: SourceContextReadPort;
      context: TrustedConnectorOperationContext;
      request: SourceContextReadRequest;
    }>
  >;
}

export interface GitLabSourceObservationProjection {
  append(
    manager: EntityManager,
    command: ConnectorCommand,
    result: SourceContextReadResult,
  ): Promise<void>;
}

export class TypeOrmGitLabSourceRefreshQueue {
  constructor(private readonly source: DataSource) {}

  async enqueue(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      actor: ConnectorCommand["actor"];
      authorizationBasis: ConnectorCommand["initialAuthorizationBasis"];
      authorizationBasisHash: string;
      bindingRef: ConnectorCommand["bindingRef"];
      profileRef: ConnectorCommand["profileRef"];
      selector: SourceContextReadRequest["selector"];
      requestKey: string;
      correlationId: string;
      causationId: string;
      requestedAt: string;
    }>,
  ): Promise<Readonly<{ commandId: string; replayed: boolean }>> {
    if (
      input.actor.kind !== "HUMAN" ||
      input.requestKey.length < 8 ||
      input.requestKey.length > 200
    )
      throw new Error("GITLAB_SOURCE_REFRESH_REQUEST_INVALID");
    const operation =
      input.selector.sourceKind === "MERGE_REQUEST"
        ? "merge-request.read"
        : input.selector.sourceKind === "COMMIT"
          ? "commit.read"
          : "build.read";
    const requestKeyHash = sha256(input.requestKey);
    const identity = `${input.workspaceId}:${input.projectId}:${operation}:${sha256(input.selector as unknown as JsonValue)}:${requestKeyHash}`;
    const commandId = deterministicUuid(`gitlab-source-refresh:${identity}`);
    const effectIdempotencyKey = `gitlab-source-refresh:${sha256(identity)}`;
    const at = new Date(input.requestedAt);
    if (Number.isNaN(at.getTime())) throw new Error("GITLAB_SOURCE_REFRESH_TIME_INVALID");
    const target = Object.freeze({ kind: "SOURCE_CONTEXT", selector: input.selector });
    const payload = Object.freeze({
      schemaVersion: "source-context.read@1.0.0",
      messageType: "REQUEST",
      operation,
      selector: input.selector,
    });
    const command: ConnectorCommand = Object.freeze({
      id: commandId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actor: input.actor,
      commandType: "gitlab.source-context.refresh",
      capability: Object.freeze({
        key: gitLabSourceRefreshCapabilityKey,
        exactContractVersion: "1.0.0",
        operation,
        logicalRole: "SOURCE_CONTEXT",
      }),
      target,
      targetHash: sha256(target as unknown as JsonValue),
      payload,
      payloadHash: sha256(payload as unknown as JsonValue),
      expectedExternalState: Object.freeze({ observation: "APPEND_ONLY" }),
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
        [input.workspaceId, input.projectId, effectIdempotencyKey],
      )) as readonly { id: string }[];
      if (replay[0]) return Object.freeze({ commandId: replay[0].id, replayed: true });
      await new TypeOrmCommandRepository(this.source).insert(command, manager);
      await manager.query(
        `INSERT INTO command_outbox(id,command_id,workspace_id,project_id,state,available_at,attempts,envelope_hash,created_at) VALUES($1,$2,$3,$4,'READY',$5,0,$6,$5)`,
        [
          deterministicUuid(`gitlab-source-refresh-outbox:${identity}`),
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

export class GitLabSourceContextWorker {
  readonly #delivery: TypeOrmCommandDeliveryStore;

  constructor(
    source: DataSource,
    private readonly authority: GitLabSourceRefreshAuthority,
    private readonly observations: GitLabSourceObservationProjection,
  ) {
    this.#delivery = new TypeOrmCommandDeliveryStore(source);
  }

  async runOne(now = new Date()): Promise<"IDLE" | "CONFIRMED"> {
    const claims = await this.#delivery.claim(now, new Date(now.getTime() + 30_000), 1, [
      gitLabSourceRefreshCapabilityKey,
    ]);
    const claim = claims[0];
    if (!claim) return "IDLE";
    const command = await this.#delivery.markDispatched(claim.outbox, now, 30_000);
    const scope = Object.freeze({
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      commandId: command.id,
    });
    try {
      const materialized = await this.authority.materialize(command);
      if (materialized.request.operation !== command.capability.operation)
        throw new Error("GITLAB_SOURCE_REFRESH_AUTHORITY_MISMATCH");
      const result = await materialized.port.read(materialized.context, materialized.request);
      await this.#delivery.confirmWith(
        scope,
        result,
        now,
        async (manager) => {
          await this.observations.append(manager, command, result);
        },
        Object.freeze({
          attemptCount: command.attemptCount,
          leaseExpiresAt: command.executionLeaseExpiresAt!,
        }),
      );
      return "CONFIRMED";
    } catch (error) {
      await this.#delivery.fail(scope, "GITLAB_SOURCE_REFRESH_FAILED", now);
      throw error;
    }
  }
}
