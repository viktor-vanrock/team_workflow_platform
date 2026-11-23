import type { DataSource } from "typeorm";

import {
  assertExactRevisionRef,
  assertProjectScope,
  type ConnectorCommand,
  DenyByDefaultAuthorizationPolicy,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  validateConnectorCommandSnapshot,
  type WorkspaceContext,
} from "@awp/platform-core";
import {
  TypeOrmIdentityRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

import type {
  CorporateConnectorBinding,
  CorporateConnectorRequestAuthority,
} from "./connector-factories.ts";
import type { PilotCommandEffectGuard } from "./effect-guard.ts";

type Purpose = Parameters<CorporateConnectorRequestAuthority["authorize"]>[1];
export interface CorporateConnectorGrant {
  readonly binding: CorporateConnectorBinding;
  readonly integrationBindingRef: ExactRevisionRef;
  readonly serviceIdentity: Readonly<{ issuer: string; subject: string; serviceKey: string }>;
  readonly permissions: Readonly<Partial<Record<Purpose, string>>>;
}
export interface CorporateConnectorCommandAdmission {
  /** The command bound by the current worker invocation, reloaded from its durable store. */
  load(binding: CorporateConnectorBinding): Promise<ConnectorCommand | undefined>;
  readonly guard: PilotCommandEffectGuard;
}

/** Intersects deployment bindings with current Core rights; it cannot grant an entitlement. */
export class TypeOrmCorporateConnectorAuthority implements CorporateConnectorRequestAuthority {
  readonly #grants = new Map<string, CorporateConnectorGrant>();
  readonly #identities: TypeOrmIdentityRepository;
  readonly #access: TypeOrmScopedAccessRepository;
  readonly #policy = new DenyByDefaultAuthorizationPolicy();
  constructor(
    private readonly source: DataSource,
    grants: readonly CorporateConnectorGrant[],
    private readonly commands?: CorporateConnectorCommandAdmission,
  ) {
    this.#identities = new TypeOrmIdentityRepository(source);
    this.#access = new TypeOrmScopedAccessRepository(source);
    for (const input of grants) {
      const grant = freezePilotValue(structuredClone(input));
      const binding = grant.binding;
      assertProjectScope(binding);
      [
        binding.ref,
        binding.profileRef,
        binding.connectionRef,
        binding.policyRef,
        grant.integrationBindingRef,
      ].forEach(assertExactRevisionRef);
      if (
        this.#grants.has(binding.ref.id) ||
        !grant.serviceIdentity.issuer ||
        !grant.serviceIdentity.subject ||
        !grant.serviceIdentity.serviceKey ||
        Object.entries(grant.permissions).some(
          ([purpose, permission]) =>
            !["CONNECTOR_READ", "CONNECTOR_WRITE", "CONNECTOR_WEBHOOK"].includes(purpose) ||
            !/^[a-z][a-z0-9_.-]{0,127}$/u.test(permission),
        )
      )
        throw new Error("CORPORATE_CONNECTOR_GRANT_INVALID");
      this.#grants.set(binding.ref.id, grant);
    }
  }

  async authorize(
    binding: CorporateConnectorBinding,
    purpose: Purpose,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      const grant = this.#grants.get(binding.ref.id);
      const permission = grant?.permissions[purpose];
      if (
        !grant ||
        !permission ||
        signal.aborted ||
        pilotContentHash(grant.binding) !== pilotContentHash(binding) ||
        Date.parse(binding.expiresAt) <= Date.now()
      )
        return false;
      const identity = await this.#identities.findByVerifiedSubject(
        grant.serviceIdentity.issuer,
        grant.serviceIdentity.subject,
      );
      if (identity?.kind !== "SERVICE" || identity.id !== binding.servicePrincipalId) return false;
      const scope = {
        kind: "PROJECT" as const,
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
      };
      const workspace = await this.#access.getWorkspace({
        kind: "WORKSPACE",
        workspaceId: scope.workspaceId,
      });
      const project = await this.#access.getProject(scope);
      if (
        workspace?.state !== "ACTIVE" ||
        !project ||
        !["ACTIVE", "SUSPENDED"].includes(project.state)
      )
        return false;
      const context: WorkspaceContext = {
        scope,
        actor: {
          kind: "SERVICE",
          principalId: identity.id,
          serviceKey: grant.serviceIdentity.serviceKey,
        },
        correlationId: "corporate-connector-authority",
        causationId: "corporate-connector-authority",
      };
      const at = new Date();
      const decision = this.#policy.decide({
        context,
        permission,
        resourceClassification: project.classification,
        facts: await this.#access.authorizationFacts(scope, identity.id, at),
        at,
        policyVersion: `${binding.policyRef.id}:${binding.policyRef.version}:${binding.policyRef.contentHash}`,
        operationClass: purpose === "CONNECTOR_WRITE" ? "EFFECT" : "READ",
        projectOperationalState: project.state === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      });
      if (!decision.allowed || signal.aborted) return false;
      // Configuration rows are queried only after scope authorization. Every current head and exact
      // content hash must match; the chain itself must connect this binding -> profile -> connection.
      const chain = (await this.source.query(
        `
SELECT b.id FROM project_integration_binding_revisions b
JOIN project_integration_binding_headers bh ON bh.workspace_id=b.workspace_id AND bh.project_id=b.project_id AND bh.id=b.header_id AND bh.current_published_version=b.version
JOIN connector_profile_revisions p ON p.workspace_id=b.workspace_id AND p.header_id=$6 AND p.version=$7 AND p.content_hash=$8 AND p.status='PUBLISHED'
JOIN connector_profile_headers ph ON ph.workspace_id=p.workspace_id AND ph.id=p.header_id AND ph.current_published_version=p.version
JOIN connection_revisions c ON c.workspace_id=b.workspace_id AND c.header_id=$9 AND c.version=$10 AND c.content_hash=$11 AND c.status='PUBLISHED'
JOIN connection_headers ch ON ch.workspace_id=c.workspace_id AND ch.id=c.header_id AND ch.current_published_version=c.version
WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.header_id=$3 AND b.version=$4 AND b.content_hash=$5 AND b.status='PUBLISHED'
AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.content->'entries') entry WHERE entry->'profileRef' @> $12::jsonb)
AND p.content->'connectionRef' @> $13::jsonb`,
        [
          binding.workspaceId,
          binding.projectId,
          grant.integrationBindingRef.id,
          grant.integrationBindingRef.version,
          grant.integrationBindingRef.contentHash,
          binding.profileRef.id,
          binding.profileRef.version,
          binding.profileRef.contentHash,
          binding.connectionRef.id,
          binding.connectionRef.version,
          binding.connectionRef.contentHash,
          JSON.stringify({ id: binding.profileRef.id, version: binding.profileRef.version }),
          JSON.stringify({ id: binding.connectionRef.id, version: binding.connectionRef.version }),
        ],
      )) as readonly unknown[];
      if (chain.length !== 1 || signal.aborted) return false;
      if (purpose === "CONNECTOR_WRITE") {
        if (!this.commands) return false;
        const command = await this.commands.load(binding);
        if (
          !command ||
          command.workspaceId !== binding.workspaceId ||
          command.projectId !== binding.projectId ||
          command.profileRef.id !== binding.profileRef.id ||
          command.profileRef.version !== binding.profileRef.version ||
          command.bindingRef.id !== grant.integrationBindingRef.id ||
          command.bindingRef.version !== grant.integrationBindingRef.version ||
          command.status !== "DISPATCHED" ||
          command.effectGateDecision !== "ALLOWED" ||
          !command.executionLeaseExpiresAt ||
          command.executionLeaseExpiresAt.getTime() <= Date.now()
        )
          return false;
        validateConnectorCommandSnapshot(command);
        await this.commands.guard.assertCommandAllowed(command);
      }
      return (
        !signal.aborted &&
        Number.isFinite(Date.parse(binding.expiresAt)) &&
        Date.parse(binding.expiresAt) > Date.now()
      );
    } catch {
      return false;
    }
  }
}
