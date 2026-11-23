import type { DataSource, EntityManager } from "typeorm";

import type {
  ManualSessionAdmissionHook,
  QaAuthorizationBasis,
  QaHumanActor,
  QaProjectEffectGuardPort,
  QaScope,
} from "@awp/competency-qa/node";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
} from "@awp/platform-core";

import { RuntimeQaManualSessionAdmissionAdapter } from "../qa/platform-adapters.ts";

type SessionPermission = "qa.session.plan" | "qa.session.execute" | "queue.work-admit";
export interface QaSessionRuntimeAuthority extends QaScope {
  readonly actor: QaHumanActor;
  authorize(
    permission: SessionPermission,
  ): Promise<Readonly<{ actor: QaHumanActor; basis: QaAuthorizationBasis; scope: QaScope }>>;
}
export interface QaSessionAdmissionContext extends QaSessionRuntimeAuthority {
  readonly correlationId: string;
  readonly causationId: string;
  readonly overrideIntent?: Readonly<{ reason: string; expiresAt: string }>;
}
export interface QaSessionRuntime {
  profiles(
    source: Pick<DataSource, "query">,
    authority: QaSessionRuntimeAuthority,
    bindingRef: Readonly<{ id: string; version: number }>,
    permission: "qa.session.plan" | "qa.session.execute",
  ): Promise<readonly Readonly<{ id: string; version: number }>[]>;
  admission(manager: EntityManager, context: QaSessionAdmissionContext): ManualSessionAdmissionHook;
}
export interface QaSessionRuntimePins extends QaScope {
  readonly bindingRef: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
}
const denied = () => new Error("QA_SESSION_CONFIGURATION_DENIED");

/** Corporate session configuration is an exact published chain, never a local seed profile. */
export class PublishedQaSessionRuntime implements QaSessionRuntime {
  readonly #pins: readonly QaSessionRuntimePins[];
  constructor(
    pins: readonly QaSessionRuntimePins[],
    private readonly effects: QaProjectEffectGuardPort,
  ) {
    if (
      !pins.length ||
      pins.length > 100 ||
      new Set(pins.map((value) => `${value.workspaceId}:${value.projectId}`)).size !== pins.length
    )
      throw denied();
    for (const value of pins) {
      if (!value.workspaceId || !value.projectId) throw denied();
      [value.bindingRef, value.profileRef, value.connectionRef].forEach(assertExactRevisionRef);
    }
    this.#pins = freezePilotValue(structuredClone(pins));
  }
  async profiles(
    source: Pick<DataSource, "query">,
    authority: QaSessionRuntimeAuthority,
    bindingRef: Readonly<{ id: string; version: number }>,
    permission: "qa.session.plan" | "qa.session.execute",
  ) {
    await this.authorize(authority, permission);
    const pins = this.pins(authority);
    if (bindingRef.id !== pins.bindingRef.id || bindingRef.version !== pins.bindingRef.version)
      throw denied();
    await assertCurrentQaOperationalConfiguration(source, pins);
    await this.authorize(authority, permission);
    return Object.freeze([
      Object.freeze({ id: pins.profileRef.id, version: pins.profileRef.version }),
    ]);
  }
  admission(
    manager: EntityManager,
    context: QaSessionAdmissionContext,
  ): ManualSessionAdmissionHook {
    return {
      admit: async (previous, next) => {
        const authorization = await this.authorize(context, "queue.work-admit");
        this.pins(context);
        if (
          [previous, next].some(
            (session) =>
              session.workspaceId !== context.workspaceId ||
              session.projectId !== context.projectId,
          ) ||
          previous.id !== next.id
        )
          throw denied();
        const profiles = await this.profiles(
          manager,
          context,
          next.targetSnapshot.bindingRef,
          "qa.session.execute",
        );
        if (
          profiles.length !== next.targetSnapshot.profileRefs.length ||
          !profiles.every((ref) =>
            next.targetSnapshot.profileRefs.some(
              (other) => other.id === ref.id && other.version === ref.version,
            ),
          )
        )
          throw denied();
        await this.effects.assertEffectsAllowed({
          workspaceId: context.workspaceId,
          projectId: context.projectId,
        });
        const result = await new RuntimeQaManualSessionAdmissionAdapter(manager, {
          actor: authorization.actor,
          authorizationBasis: authorization.basis,
          correlationId: context.correlationId,
          causationId: context.causationId,
          ...(context.overrideIntent ? { overrideIntent: context.overrideIntent } : {}),
        }).admit(previous, next);
        await this.authorize(context, "queue.work-admit");
        return result;
      },
    };
  }
  private pins(scope: QaScope) {
    const value = this.#pins.find(
      (entry) => entry.workspaceId === scope.workspaceId && entry.projectId === scope.projectId,
    );
    if (!value) throw denied();
    return value;
  }
  private async authorize(context: QaSessionRuntimeAuthority, permission: SessionPermission) {
    try {
      const result = await context.authorize(permission);
      if (
        result.actor.kind !== "HUMAN" ||
        result.actor.principalId !== context.actor.principalId ||
        result.scope.workspaceId !== context.workspaceId ||
        result.scope.projectId !== context.projectId ||
        result.basis.kind !== "PROJECT" ||
        !result.basis.membershipRef ||
        !result.basis.entitlementRefs.length ||
        !result.basis.roleAssignmentRefs.length
      )
        throw denied();
      return result;
    } catch {
      throw denied();
    }
  }
}

/** The caller must authorize the project before reading this exact configuration chain. */
export async function assertCurrentQaOperationalConfiguration(
  source: Pick<DataSource, "query">,
  pins: QaSessionRuntimePins,
): Promise<void> {
  const rows = (await source.query(
    `SELECT p.header_id,p.version FROM project_integration_binding_revisions b
      JOIN project_integration_binding_headers bh ON bh.workspace_id=b.workspace_id AND bh.project_id=b.project_id AND bh.id=b.header_id AND bh.current_published_version=b.version
      JOIN connector_profile_revisions p ON p.workspace_id=b.workspace_id AND p.header_id=$6 AND p.version=$7 AND p.content_hash=$8 AND p.status='PUBLISHED'
      JOIN connector_profile_headers ph ON ph.workspace_id=p.workspace_id AND ph.id=p.header_id AND ph.current_published_version=p.version
      JOIN connection_revisions c ON c.workspace_id=b.workspace_id AND c.header_id=$9 AND c.version=$10 AND c.content_hash=$11 AND c.status='PUBLISHED'
      JOIN connection_headers ch ON ch.workspace_id=c.workspace_id AND ch.id=c.header_id AND ch.current_published_version=c.version
      WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.header_id=$3 AND b.version=$4 AND b.content_hash=$5 AND b.status='PUBLISHED'
      AND 1=(SELECT count(*) FROM jsonb_array_elements(b.content->'entries') entry WHERE entry->>'logicalRole'='QA_REQUEST_AUTHORITY' AND entry->>'capabilityKey'='operational-work-item' AND entry->>'exactContractVersion'='1.0.0')
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.content->'entries') entry WHERE entry->>'logicalRole'='QA_REQUEST_AUTHORITY' AND entry->>'capabilityKey'='operational-work-item' AND entry->>'exactContractVersion'='1.0.0' AND entry->>'environmentScope'='NON_PROD' AND entry->'profileRef' @> $12::jsonb AND entry->'externalScope'->'value'->>'environmentScope'='NON_PROD')
      AND 1=(SELECT count(*) FROM jsonb_array_elements(p.content->'capabilityConfigurations') config WHERE config->>'capabilityKey'='operational-work-item' AND config->>'exactContractVersion'='1.0.0')
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'capabilityConfigurations') config WHERE config->>'capabilityKey'='operational-work-item' AND config->>'exactContractVersion'='1.0.0' AND config->'environmentScopes' ? 'NON_PROD' AND config->'operations' @> '[{"operation":"request.transition","effect":"WRITE"}]'::jsonb)
      AND p.content->'connectionRef' @> $13::jsonb`,
    [
      pins.workspaceId,
      pins.projectId,
      pins.bindingRef.id,
      pins.bindingRef.version,
      pins.bindingRef.contentHash,
      pins.profileRef.id,
      pins.profileRef.version,
      pins.profileRef.contentHash,
      pins.connectionRef.id,
      pins.connectionRef.version,
      pins.connectionRef.contentHash,
      JSON.stringify({ id: pins.profileRef.id, version: pins.profileRef.version }),
      JSON.stringify({ id: pins.connectionRef.id, version: pins.connectionRef.version }),
    ],
  )) as readonly { header_id: string; version: number }[];
  if (rows.length !== 1) throw denied();
}
