import type { DataSource, EntityManager } from "typeorm";

import { qaAggregateSnapshotHash, type QaScope } from "@awp/competency-qa/node";
import {
  assertExactRevisionRef,
  type CompleteOperationalObservation,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  freezePilotValue,
} from "@awp/platform-core";
import { TypeOrmOperationalAuthorityRepository } from "@awp/platform-persistence-typeorm";

import type { QaCompletionConfigurationPort } from "./completion-runtime.ts";

export interface QaCompletionPins extends QaScope {
  readonly bindingRef: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly mappingRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
  readonly authorityScopeKey: string;
  readonly externalProjectId: string;
  readonly maximumClassificationKey: string;
  readonly maximumProjectionAgeMs: number;
  readonly allowedFromStates: readonly CompleteOperationalObservation["normalizedStatus"][];
}
type Row = Record<string, unknown>;
const denied = () => new Error("QA_COMPLETION_CONFIGURATION_DENIED");
const record = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
  return value as Row;
};
const array = (value: unknown): Row[] => {
  if (!Array.isArray(value)) throw denied();
  return value.map(record);
};
const matches = (value: unknown, ref: ExactRevisionRef) => {
  const actual = record(value);
  return (
    actual.id === ref.id &&
    actual.version === ref.version &&
    (actual.contentHash === undefined || actual.contentHash === ref.contentHash)
  );
};

/** The expected external version is a fresh confirmed Core observation, never the intake snapshot. */
export class PublishedQaCompletionConfiguration implements QaCompletionConfigurationPort {
  readonly #pins: readonly QaCompletionPins[];
  constructor(
    private readonly source: DataSource,
    pins: readonly QaCompletionPins[],
    private readonly clock = Date.now,
  ) {
    if (
      !pins.length ||
      pins.length > 100 ||
      new Set(pins.map((pin) => `${pin.workspaceId}:${pin.projectId}`)).size !== pins.length
    )
      throw denied();
    for (const pin of pins) {
      [pin.bindingRef, pin.profileRef, pin.mappingRef, pin.connectionRef].forEach(
        assertExactRevisionRef,
      );
      if (
        ![pin.workspaceId, pin.projectId, pin.authorityScopeKey, pin.externalProjectId].every(
          (value) => typeof value === "string" && value.length > 0 && value.length <= 128,
        ) ||
        !Number.isSafeInteger(pin.maximumProjectionAgeMs) ||
        pin.maximumProjectionAgeMs < 1 ||
        pin.maximumProjectionAgeMs > 3_600_000 ||
        !pin.allowedFromStates.length ||
        pin.allowedFromStates.some(
          (value) => !["READY", "PLANNED", "IN_PROGRESS", "REVIEW", "BLOCKED"].includes(value),
        )
      )
        throw denied();
      defaultClassificationCatalog.reference(pin.maximumClassificationKey);
    }
    this.#pins = freezePilotValue(structuredClone(pins));
  }
  async load(manager: EntityManager, scope: QaScope, workItemId: string) {
    const pin = this.#pins.find(
      (value) => value.workspaceId === scope.workspaceId && value.projectId === scope.projectId,
    );
    if (!pin) throw denied();
    const revision = async (
      table:
        "project_integration_binding" | "connector_profile" | "connector_mapping" | "connection",
      ref: ExactRevisionRef,
    ) => {
      const binding = table === "project_integration_binding";
      const found = (await manager.query(
        `SELECT r.content FROM ${table}_revisions r JOIN ${table}_headers h ON h.id=r.header_id AND h.workspace_id=r.workspace_id AND h.current_published_version=r.version${binding ? " AND h.project_id=r.project_id" : ""}
        WHERE r.workspace_id=$1 AND r.header_id=$2 AND r.version=$3 AND r.content_hash=$4 AND r.status='PUBLISHED'${binding ? " AND r.project_id=$5" : ""} FOR SHARE OF h`,
        [
          scope.workspaceId,
          ref.id,
          ref.version,
          ref.contentHash,
          ...(binding ? [scope.projectId] : []),
        ],
      )) as { content: unknown }[];
      if (
        found.length !== 1 ||
        qaAggregateSnapshotHash(found[0]!.content as never) !== ref.contentHash
      )
        throw denied();
      return record(found[0]!.content);
    };
    const binding = await revision("project_integration_binding", pin.bindingRef);
    const entries = array(binding.entries).filter(
      (entry) => entry.logicalRole === "QA_REQUEST_AUTHORITY",
    );
    if (entries.length !== 1) throw denied();
    const entry = entries[0]!;
    const external = record(record(entry.externalScope).value);
    if (
      entry.capabilityKey !== "operational-work-item" ||
      entry.exactContractVersion !== "1.0.0" ||
      entry.environmentScope !== "NON_PROD" ||
      !matches(entry.profileRef, pin.profileRef) ||
      external.authorityScopeKey !== pin.authorityScopeKey ||
      external.environmentScope !== "NON_PROD" ||
      !Array.isArray(external.allowedEntityKinds) ||
      !external.allowedEntityKinds.includes("REQUEST")
    )
      throw denied();
    const profile = await revision("connector_profile", pin.profileRef);
    const mapping = await revision("connector_mapping", pin.mappingRef);
    const connection = await revision("connection", pin.connectionRef);
    if (
      !matches(profile.mappingRef, pin.mappingRef) ||
      !matches(profile.connectionRef, pin.connectionRef) ||
      !profile.connectorKey ||
      profile.connectorKey !== mapping.connectorKey ||
      profile.connectorKey !== connection.connectorKey ||
      mapping.authorityScopeKey !== pin.authorityScopeKey ||
      connection.projectId !== pin.externalProjectId
    )
      throw denied();
    const capabilities = array(profile.capabilityConfigurations).filter(
      (capability) =>
        capability.capabilityKey === "operational-work-item" &&
        capability.exactContractVersion === "1.0.0",
    );
    if (
      capabilities.length !== 1 ||
      !Array.isArray(capabilities[0]!.environmentScopes) ||
      !capabilities[0]!.environmentScopes.includes("NON_PROD") ||
      array(capabilities[0]!.operations).filter(
        (operation) => operation.operation === "request.transition" && operation.effect === "WRITE",
      ).length !== 1 ||
      !Array.isArray(capabilities[0]!.allowedDataClassifications) ||
      typeof entry.classificationCeilingKey !== "string"
    )
      throw denied();
    const configuredCeiling = defaultClassificationCatalog.reference(pin.maximumClassificationKey);
    const bindingCeiling = defaultClassificationCatalog.reference(entry.classificationCeilingKey);
    const allowed = capabilities[0]!.allowedDataClassifications;
    const allowedDataClassifications = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"].filter(
      (key) =>
        allowed.includes(key) &&
        defaultClassificationCatalog.permits(
          configuredCeiling,
          defaultClassificationCatalog.reference(key),
        ) &&
        defaultClassificationCatalog.permits(
          bindingCeiling,
          defaultClassificationCatalog.reference(key),
        ),
    );
    const [work] = (await manager.query(
      `SELECT b.*,i.external_request_id FROM work_items w JOIN operational_bindings b ON b.id=w.operational_binding_id AND b.workspace_id=w.workspace_id AND b.project_id=w.project_id AND b.work_item_id=w.id
      JOIN qa_request_extensions e ON e.workspace_id=w.workspace_id AND e.project_id=w.project_id AND e.work_item_id=w.id
      JOIN qa_request_input_revisions i ON i.input_revision_id=e.current_input_revision_id AND i.workspace_id=e.workspace_id AND i.project_id=e.project_id AND i.work_item_id=e.work_item_id
      WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3 FOR SHARE OF b`,
      [scope.workspaceId, scope.projectId, workItemId],
    )) as Row[];
    const projection = work
      ? await new TypeOrmOperationalAuthorityRepository(this.source).confirmedProjectionForWorkItem(
          scope,
          workItemId,
          manager,
        )
      : undefined;
    const now = this.clock();
    const snapshot = projection?.snapshot;
    if (
      !work ||
      !projection ||
      work.sync_state !== "SYNCED" ||
      work.external_entity_type !== "REQUEST" ||
      work.external_entity_id !== work.external_request_id ||
      projection.freshness !== "CURRENT" ||
      Date.parse(projection.observedAt) > now ||
      Date.parse(projection.observedAt) + pin.maximumProjectionAgeMs <= now ||
      !matches(work.project_integration_binding_ref, pin.bindingRef) ||
      !matches(work.connector_profile_ref, pin.profileRef) ||
      !matches(work.connection_ref, pin.connectionRef) ||
      !matches(work.mapping_ref, pin.mappingRef) ||
      !snapshot ||
      snapshot.externalEntityId !== work.external_request_id ||
      !matches(snapshot.profileRef, pin.profileRef) ||
      !matches(snapshot.mappingRef, pin.mappingRef) ||
      !matches(snapshot.connectionRef, pin.connectionRef) ||
      !pin.allowedFromStates.includes(snapshot.normalizedStatus) ||
      !projection.externalRevisionToken
    )
      throw new Error("QA_COMPLETION_PROJECTION_UNAVAILABLE");
    return freezePilotValue({
      bindingRef: pin.bindingRef,
      profileRef: pin.profileRef,
      profileRefs: [pin.profileRef],
      authorityScopeKey: pin.authorityScopeKey,
      maximumClassificationKey: pin.maximumClassificationKey,
      allowedDataClassifications,
      configurationChain: [
        {
          logicalRole: "QA_REQUEST_AUTHORITY",
          profileRef: pin.profileRef,
          mappingRef: pin.mappingRef,
          connectionRef: pin.connectionRef,
        },
      ],
      projection: {
        externalEntityId: snapshot.externalEntityId,
        normalizedStatus: snapshot.normalizedStatus,
        externalVersion: projection.externalRevisionToken,
      },
    });
  }
}
