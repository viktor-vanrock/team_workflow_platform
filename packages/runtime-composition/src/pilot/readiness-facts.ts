import type { DataSource, EntityManager } from "typeorm";

import {
  QaProjectPolicyRepository,
  type QaRequestExtension,
  type QaRequestInputRevision,
} from "@awp/competency-qa/node";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  type ProjectRegistryRevision,
} from "@awp/platform-core";
import { TypeOrmOperationalAuthorityRepository } from "@awp/platform-persistence-typeorm";

import {
  assertCurrentQaOperationalConfiguration,
  type QaSessionRuntimePins,
} from "./manual-session-runtime.ts";
import { currentQaRequesterEntitlement } from "./readiness-requester.ts";
import type { QaReadinessFacts, QaReadinessFactsPort } from "./readiness-runtime.ts";

export interface QaReadinessPins extends QaSessionRuntimePins {
  readonly contextRef: ExactRevisionRef;
  readonly freshnessPolicyRef: ExactRevisionRef;
  readonly maximumProjectionAgeMs: number;
  readonly authorityScopeKey: string;
}

/** Reads current Core authority and published configuration. It never supplies a seeded READY fact. */
export class PublishedQaReadinessFacts implements QaReadinessFactsPort {
  readonly #pins: readonly QaReadinessPins[];
  constructor(
    private readonly source: DataSource,
    pins: readonly QaReadinessPins[],
    private readonly clock = Date.now,
  ) {
    if (
      !pins.length ||
      pins.length > 100 ||
      new Set(pins.map((pin) => `${pin.workspaceId}:${pin.projectId}`)).size !== pins.length
    )
      throw new Error("QA_READINESS_CONFIGURATION_DENIED");
    for (const pin of pins) {
      [
        pin.bindingRef,
        pin.profileRef,
        pin.connectionRef,
        pin.contextRef,
        pin.freshnessPolicyRef,
      ].forEach(assertExactRevisionRef);
      if (
        !pin.workspaceId ||
        !pin.projectId ||
        !pin.authorityScopeKey ||
        pin.authorityScopeKey.length > 128 ||
        !Number.isSafeInteger(pin.maximumProjectionAgeMs) ||
        pin.maximumProjectionAgeMs < 1 ||
        pin.maximumProjectionAgeMs > 3_600_000
      )
        throw new Error("QA_READINESS_CONFIGURATION_DENIED");
    }
    this.#pins = freezePilotValue(structuredClone(pins));
  }
  async load(
    manager: EntityManager,
    extension: QaRequestExtension,
    current: QaRequestInputRevision,
  ): Promise<QaReadinessFacts> {
    const pin = this.#pins.find(
      (value) =>
        value.workspaceId === extension.workspaceId && value.projectId === extension.projectId,
    );
    if (
      !pin ||
      current.workspaceId !== pin.workspaceId ||
      current.projectId !== pin.projectId ||
      current.workItemId !== extension.workItemId ||
      current.operationalBindingRef.id !== pin.bindingRef.id ||
      current.operationalBindingRef.version !== pin.bindingRef.version ||
      extension.projectContextRef.id !== pin.contextRef.id ||
      extension.projectContextRef.version !== pin.contextRef.version ||
      extension.projectContextRef.contentHash !== pin.contextRef.contentHash
    )
      throw new Error("QA_READINESS_CONFIGURATION_DENIED");
    await assertCurrentQaOperationalConfiguration(manager, pin);
    const context = await new QaProjectPolicyRepository(manager).currentProjectContext(
      pin,
      pin.contextRef.id,
    );
    if (
      !context ||
      context.state !== "PUBLISHED" ||
      context.version !== pin.contextRef.version ||
      context.contentHash !== pin.contextRef.contentHash ||
      context.dorRuleSetRef.key !== extension.dorRuleSetRef.key ||
      context.dorRuleSetRef.version !== extension.dorRuleSetRef.version ||
      context.dorRuleSetRef.contentHash !== extension.dorRuleSetRef.contentHash
    )
      throw new Error("QA_READINESS_CONFIGURATION_DENIED");
    const [project] = (await manager.query(
      `SELECT p.state,w.state AS workspace_state,r.semantic_body FROM projects p
      JOIN workspaces w ON w.id=p.workspace_id
      JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version
      WHERE p.workspace_id=$1 AND p.id=$2`,
      [pin.workspaceId, pin.projectId],
    )) as { state: string; workspace_state: string; semantic_body: ProjectRegistryRevision }[];
    if (!project) throw new Error("QA_READINESS_CONFIGURATION_DENIED");
    const registry = project.semantic_body;
    const now = this.clock();
    const projection = await new TypeOrmOperationalAuthorityRepository(
      this.source,
    ).confirmedProjectionForWorkItem(pin, current.workItemId, manager);
    const bindings = (await manager.query(
      `SELECT id FROM operational_bindings WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
      AND project_integration_binding_ref @> $4::jsonb AND connector_profile_ref @> $5::jsonb AND connection_ref @> $6::jsonb
      AND external_entity_id=$7 AND sync_state='SYNCED'`,
      [
        pin.workspaceId,
        pin.projectId,
        current.workItemId,
        JSON.stringify({ id: pin.bindingRef.id, version: pin.bindingRef.version }),
        JSON.stringify({ id: pin.profileRef.id, version: pin.profileRef.version }),
        JSON.stringify({ id: pin.connectionRef.id, version: pin.connectionRef.version }),
        current.externalRequestRef.id,
      ],
    )) as unknown[];
    const snapshot = projection?.snapshot;
    const observedAt = projection ? Date.parse(projection.observedAt) : NaN;
    const accepted =
      bindings.length === 1 &&
      projection?.freshness === "CURRENT" &&
      observedAt <= now &&
      observedAt + pin.maximumProjectionAgeMs > now &&
      snapshot?.externalEntityId === current.externalRequestRef.id &&
      snapshot.requester.canonicalPrincipalId === current.originalRequesterRef.principalId &&
      snapshot.profileRef.id === pin.profileRef.id &&
      snapshot.profileRef.version === pin.profileRef.version &&
      snapshot.connectionRef.id === pin.connectionRef.id &&
      snapshot.connectionRef.version === pin.connectionRef.version;
    const mappingHealth = {
      valid: true,
      bindingRef: pin.bindingRef,
      profileRef: pin.profileRef,
      connectionRef: pin.connectionRef,
      freshnessPolicyRef: pin.freshnessPolicyRef,
    };
    return {
      authorityScopeKey: pin.authorityScopeKey,
      acceptedRequest: accepted
        ? {
            exists: true,
            externalVersion: projection.externalRevisionToken,
            normalizedStatus: snapshot.normalizedStatus,
          }
        : { exists: false },
      project: {
        state:
          project.state === "ACTIVE" && project.workspace_state === "ACTIVE"
            ? "ACTIVE"
            : "INACTIVE",
        registryRevision: registry.version,
        registryState:
          registry.verificationStatus === "CURRENT" &&
          !!registry.nextVerificationAt &&
          Date.parse(registry.nextVerificationAt) > now
            ? "CURRENT"
            : "NEEDS_REVIEW",
      },
      requesterEntitlement: await currentQaRequesterEntitlement(this.source, current),
      mappingHealth,
      contextRef: pin.contextRef,
      dorRuleSetRef: context.dorRuleSetRef,
      allowedEnvironmentRefs: context.allowedEnvironments.filter(
        (environment) => environment.scope === "NON_PROD" || environment.scope === "PREPROD",
      ),
      maximumClassificationKey: context.maximumClassificationKey,
    };
  }
}
