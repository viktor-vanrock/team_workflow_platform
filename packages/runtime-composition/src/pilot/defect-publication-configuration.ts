import type { EntityManager } from "typeorm";

import { qaAggregateSnapshotHash, type QaScope } from "@awp/competency-qa/node";
import {
  assertExactRevisionRef,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  freezePilotValue,
} from "@awp/platform-core";

import type { QaDefectPublicationConfigurationPort } from "./defect-publication-runtime.ts";

type Row = Readonly<Record<string, unknown>>;
interface ChainPins {
  readonly profileRef: ExactRevisionRef;
  readonly mappingRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
}
export interface QaDefectPublicationPins extends QaScope {
  readonly bindingRef: ExactRevisionRef;
  readonly destination: ChainPins;
  readonly requestAuthority: ChainPins;
  readonly authorityScopeKey: string;
  readonly externalProjectId: string;
  readonly externalIssueTypeId: string;
  readonly maximumClassificationKey: string;
}
const denied = () => new Error("QA_DEFECT_CONFIGURATION_DENIED");
const record = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
  return value as Row;
};
const sameRef = (value: unknown, expected: ExactRevisionRef) => {
  const ref = record(value);
  return (
    ref.id === expected.id &&
    ref.version === expected.version &&
    (ref.contentHash === undefined || ref.contentHash === expected.contentHash)
  );
};
const array = (value: unknown): readonly Row[] => {
  if (!Array.isArray(value)) throw denied();
  return value.map(record);
};

/** Deployment pins restrict the current published chain; no request or seed selects the destination. */
export class PublishedQaDefectPublicationConfiguration implements QaDefectPublicationConfigurationPort {
  readonly #pins: readonly QaDefectPublicationPins[];
  constructor(pins: readonly QaDefectPublicationPins[]) {
    if (
      !pins.length ||
      pins.length > 100 ||
      new Set(pins.map((p) => `${p.workspaceId}:${p.projectId}`)).size !== pins.length
    )
      throw denied();
    for (const value of pins) {
      if (
        ![
          value.workspaceId,
          value.projectId,
          value.authorityScopeKey,
          value.externalProjectId,
          value.externalIssueTypeId,
        ].every((v) => typeof v === "string" && v.length > 0 && v.length <= 128)
      )
        throw denied();
      defaultClassificationCatalog.reference(value.maximumClassificationKey);
      [
        value.bindingRef,
        value.destination.profileRef,
        value.destination.mappingRef,
        value.destination.connectionRef,
        value.requestAuthority.profileRef,
        value.requestAuthority.mappingRef,
        value.requestAuthority.connectionRef,
      ].forEach(assertExactRevisionRef);
    }
    this.#pins = freezePilotValue(structuredClone(pins));
  }

  async load(manager: EntityManager, scope: QaScope) {
    const pins = this.#pins.find(
      (p) => p.workspaceId === scope.workspaceId && p.projectId === scope.projectId,
    );
    if (!pins) throw denied();
    const binding = await this.revision(
      manager,
      scope,
      "project_integration_binding",
      pins.bindingRef,
    );
    const entries = array(binding.entries);
    const chain = [];
    let allowedDataClassifications = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"].filter(
      (key) =>
        defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(pins.maximumClassificationKey),
          defaultClassificationCatalog.reference(key),
        ),
    );
    for (const [logicalRole, refs, operation, entityKind] of [
      ["DEFECT_DESTINATION", pins.destination, "defect.create", "DEFECT"],
      ["QA_REQUEST_AUTHORITY", pins.requestAuthority, "request.transition", "REQUEST"],
    ] as const) {
      const matches = entries.filter((entry) => entry.logicalRole === logicalRole);
      if (matches.length !== 1) throw denied();
      const entry = matches[0]!;
      if (
        entry.capabilityKey !== "operational-work-item" ||
        entry.exactContractVersion !== "1.0.0" ||
        entry.environmentScope !== "NON_PROD" ||
        !sameRef(entry.profileRef, refs.profileRef)
      )
        throw denied();
      const external = record(record(entry.externalScope).value);
      if (
        external.authorityScopeKey !== pins.authorityScopeKey ||
        external.environmentScope !== "NON_PROD" ||
        !Array.isArray(external.allowedEntityKinds) ||
        !external.allowedEntityKinds.includes(entityKind)
      )
        throw denied();
      const profile = await this.revision(manager, scope, "connector_profile", refs.profileRef);
      const mapping = await this.revision(manager, scope, "connector_mapping", refs.mappingRef);
      const connection = await this.revision(manager, scope, "connection", refs.connectionRef);
      if (
        !sameRef(profile.mappingRef, refs.mappingRef) ||
        !sameRef(profile.connectionRef, refs.connectionRef) ||
        !profile.connectorKey ||
        profile.connectorKey !== mapping.connectorKey ||
        profile.connectorKey !== connection.connectorKey ||
        mapping.authorityScopeKey !== pins.authorityScopeKey
      )
        throw denied();
      const capabilities = array(profile.capabilityConfigurations).filter(
        (c) => c.capabilityKey === "operational-work-item" && c.exactContractVersion === "1.0.0",
      );
      if (
        capabilities.length !== 1 ||
        !Array.isArray(capabilities[0]!.environmentScopes) ||
        !capabilities[0]!.environmentScopes.includes("NON_PROD") ||
        array(capabilities[0]!.operations).filter(
          (op) => op.operation === operation && op.effect === "WRITE",
        ).length !== 1
      )
        throw denied();
      if (
        typeof entry.classificationCeilingKey !== "string" ||
        !Array.isArray(capabilities[0]!.allowedDataClassifications)
      )
        throw denied();
      const allowed = capabilities[0]!.allowedDataClassifications;
      const ceiling = defaultClassificationCatalog.reference(entry.classificationCeilingKey);
      allowedDataClassifications = allowedDataClassifications.filter(
        (key) =>
          allowed.includes(key) &&
          defaultClassificationCatalog.permits(
            ceiling,
            defaultClassificationCatalog.reference(key),
          ),
      );
      if (
        logicalRole === "DEFECT_DESTINATION" &&
        (connection.projectId !== pins.externalProjectId ||
          connection.issueTypeId !== pins.externalIssueTypeId)
      )
        throw denied();
      chain.push({
        logicalRole,
        profileRef: refs.profileRef,
        mappingRef: refs.mappingRef,
        connectionRef: refs.connectionRef,
      });
    }
    return freezePilotValue({
      bindingRef: pins.bindingRef,
      profileRef: pins.destination.profileRef,
      profileRefs: chain.map((p) => p.profileRef),
      authorityScopeKey: pins.authorityScopeKey,
      externalTarget: {
        externalProjectId: pins.externalProjectId,
        externalIssueTypeId: pins.externalIssueTypeId,
      },
      maximumClassificationKey: pins.maximumClassificationKey,
      allowedDataClassifications,
      configurationChain: chain,
    });
  }

  private async revision(
    manager: EntityManager,
    scope: QaScope,
    table: "project_integration_binding" | "connector_profile" | "connector_mapping" | "connection",
    ref: ExactRevisionRef,
  ): Promise<Row> {
    const binding = table === "project_integration_binding";
    const rows = (await manager.query(
      `SELECT r.content FROM ${table}_revisions r JOIN ${table}_headers h
      ON h.id=r.header_id AND h.workspace_id=r.workspace_id AND h.current_published_version=r.version${binding ? " AND h.project_id=r.project_id" : ""}
      WHERE r.workspace_id=$1 AND r.header_id=$2 AND r.version=$3 AND r.content_hash=$4 AND r.status='PUBLISHED'${binding ? " AND r.project_id=$5" : ""}`,
      [
        scope.workspaceId,
        ref.id,
        ref.version,
        ref.contentHash,
        ...(binding ? [scope.projectId] : []),
      ],
    )) as readonly { content: unknown }[];
    if (rows.length !== 1) throw denied();
    const content = record(rows[0]!.content);
    if (qaAggregateSnapshotHash(content as never) !== ref.contentHash) throw denied();
    return content;
  }
}
