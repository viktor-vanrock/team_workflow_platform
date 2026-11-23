import type { JsonValue, Sha256Digest } from "@awp/platform-contracts";

import type {
  AuthorizationBasisRef,
  ClassificationReference,
  ResourceScope,
  SchemaBoundValue,
  SemanticVersionReference,
  Uuid,
  VersionedReference,
} from "../shared/primitives.ts";

export type ConfigurationState = "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
export type EnvironmentClass =
  "LOCAL" | "DEVELOPMENT" | "TEST" | "NON_PROD" | "PREPROD" | "PRODUCTION";
export type BindingEnvironmentScope = "LOCAL" | "NON_PROD" | "PREPROD";
export type ConnectionHealthState = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface RevisionMetadata {
  readonly id: Uuid;
  readonly revisionId: Uuid;
  readonly workspaceId: Uuid;
  readonly version: number;
  readonly resourceVersion: number;
  readonly state: ConfigurationState;
  readonly contentHash: Sha256Digest;
  readonly validationReportId?: Uuid;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly authorizationBasis: AuthorizationBasisRef;
}

export interface ConnectionContent {
  readonly key: string;
  readonly connectorRef: SemanticVersionReference;
  readonly environmentClass: EnvironmentClass;
  readonly endpoint: string;
  readonly serviceIdentitySecretRef: string;
  readonly quarantineClassificationKey: string;
  readonly dataClassificationKey: string;
  readonly connectorConfiguration?: SchemaBoundValue<JsonValue>;
}
export type ConnectionRevision = RevisionMetadata & ConnectionContent;

export interface MappingContent {
  readonly key: string;
  readonly connectorRef: SemanticVersionReference;
  readonly mapping: SchemaBoundValue<JsonValue>;
  readonly dataClassificationKey: string;
}
export type MappingRevision = RevisionMetadata & MappingContent;

export interface ProfileOperationSelection {
  readonly operation: string;
  readonly effect: "READ" | "WRITE";
  readonly idempotencyStrategy: "NATIVE_KEY" | "NATURAL_KEY_LOOKUP" | "RECONCILIATION";
  readonly confirmationMode: "SYNC_RECEIPT" | "READ_BACK" | "WEBHOOK";
}

export interface ProfileCapabilityConfiguration {
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly operations: readonly ProfileOperationSelection[];
  readonly environmentScopes: readonly EnvironmentClass[];
  readonly allowedDataClassifications: readonly string[];
  readonly externalScope: SchemaBoundValue<JsonValue>;
  readonly payloadClassificationCeilingKey?: string;
}

export interface ProfileContent {
  readonly key: string;
  readonly connectorRef: SemanticVersionReference;
  readonly connectionRef: VersionedReference;
  readonly mappingRef?: VersionedReference & Readonly<{ contentHash?: Sha256Digest }>;
  readonly dataClassificationKey: string;
  readonly capabilityConfigurations: readonly ProfileCapabilityConfiguration[];
  readonly profileConfiguration?: SchemaBoundValue<JsonValue>;
}
export type ProfileRevision = RevisionMetadata & ProfileContent;

export interface BindingEntry {
  readonly logicalRole: string;
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly environmentScope: BindingEnvironmentScope;
  readonly classificationCeilingKey: string;
  readonly profileRef: VersionedReference;
  readonly externalScope: SchemaBoundValue<JsonValue>;
}

export interface BindingContent {
  readonly key?: string;
  readonly dataClassificationKey: string;
  readonly entries: readonly BindingEntry[];
  readonly configurationRefs?: readonly SchemaBoundValue<JsonValue>[];
  readonly resourceRefs?: readonly SchemaBoundValue<JsonValue>[];
}
export type BindingRevision = RevisionMetadata &
  BindingContent &
  Readonly<{
    projectId: Uuid;
    validatedAt?: Date;
    publishedAt?: Date;
    retiredAt?: Date;
  }>;

export interface ConnectionHealth {
  readonly workspaceId: Uuid;
  readonly connectionRef: VersionedReference;
  readonly healthState: ConnectionHealthState;
  readonly reasonCode?: string;
  readonly checkedAt: Date;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path?: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId?: Uuid;
  readonly subjectKind: "CONNECTION" | "MAPPING" | "PROFILE" | "BINDING";
  readonly subjectRef: VersionedReference;
  readonly contentHash: Sha256Digest;
  readonly status: "VALID" | "INVALID";
  readonly issues: readonly ValidationIssue[];
  readonly actorPrincipalId: Uuid;
  readonly authorizationBasis: AuthorizationBasisRef;
  readonly createdAt: Date;
}

interface ConfigurationHeader {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId?: Uuid;
  readonly key: string;
  currentPublishedVersion?: number;
  resourceVersion: number;
}

export interface IntegrationConfigurationRepository {
  insertConnection(revision: ConnectionRevision): Promise<void>;
  saveConnection(revision: ConnectionRevision): Promise<void>;
  connection(workspaceId: Uuid, id: Uuid, version: number): Promise<ConnectionRevision | undefined>;
  insertMapping(revision: MappingRevision): Promise<void>;
  saveMapping(revision: MappingRevision): Promise<void>;
  mapping(workspaceId: Uuid, id: Uuid, version: number): Promise<MappingRevision | undefined>;
  insertProfile(revision: ProfileRevision): Promise<void>;
  saveProfile(revision: ProfileRevision): Promise<void>;
  profile(workspaceId: Uuid, id: Uuid, version: number): Promise<ProfileRevision | undefined>;
  insertBinding(revision: BindingRevision): Promise<void>;
  saveBinding(revision: BindingRevision): Promise<void>;
  binding(
    workspaceId: Uuid,
    projectId: Uuid,
    id: Uuid,
    version: number,
  ): Promise<BindingRevision | undefined>;
  publish(
    kind: "CONNECTION" | "MAPPING" | "PROFILE",
    workspaceId: Uuid,
    id: Uuid,
    version: number,
    expectedResourceVersion: number,
  ): Promise<ConnectionRevision | MappingRevision | ProfileRevision>;
  saveValidationReport(report: ValidationReport): Promise<void>;
  validationReport(scope: ResourceScope, id: Uuid): Promise<ValidationReport | undefined>;
  saveConnectionHealth(health: ConnectionHealth): Promise<void>;
  connectionHealth(workspaceId: Uuid, connectionId: Uuid): Promise<ConnectionHealth | undefined>;
}

type AnyRevision = ConnectionRevision | MappingRevision | ProfileRevision | BindingRevision;
type PublishableRevision = ConnectionRevision | MappingRevision | ProfileRevision;

function keyOf(id: Uuid, version: number): string {
  return `${id}:${version}`;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryIntegrationConfigurationRepository implements IntegrationConfigurationRepository {
  readonly #headers = new Map<string, ConfigurationHeader>();
  readonly #connections = new Map<string, ConnectionRevision>();
  readonly #mappings = new Map<string, MappingRevision>();
  readonly #profiles = new Map<string, ProfileRevision>();
  readonly #bindings = new Map<string, BindingRevision>();
  readonly #reports = new Map<Uuid, ValidationReport>();
  readonly #health = new Map<string, ConnectionHealth>();

  async insertConnection(revision: ConnectionRevision): Promise<void> {
    this.#insert("CONNECTION", revision, this.#connections);
  }
  async saveConnection(revision: ConnectionRevision): Promise<void> {
    this.#save("CONNECTION", revision, this.#connections);
  }
  async connection(
    workspaceId: Uuid,
    id: Uuid,
    version: number,
  ): Promise<ConnectionRevision | undefined> {
    const item = this.#connections.get(keyOf(id, version));
    return item?.workspaceId === workspaceId ? clone(item) : undefined;
  }
  async insertMapping(revision: MappingRevision): Promise<void> {
    this.#insert("MAPPING", revision, this.#mappings);
  }
  async saveMapping(revision: MappingRevision): Promise<void> {
    this.#save("MAPPING", revision, this.#mappings);
  }
  async mapping(
    workspaceId: Uuid,
    id: Uuid,
    version: number,
  ): Promise<MappingRevision | undefined> {
    const item = this.#mappings.get(keyOf(id, version));
    return item?.workspaceId === workspaceId ? clone(item) : undefined;
  }
  async insertProfile(revision: ProfileRevision): Promise<void> {
    this.#insert("PROFILE", revision, this.#profiles);
  }
  async saveProfile(revision: ProfileRevision): Promise<void> {
    this.#save("PROFILE", revision, this.#profiles);
  }
  async profile(
    workspaceId: Uuid,
    id: Uuid,
    version: number,
  ): Promise<ProfileRevision | undefined> {
    const item = this.#profiles.get(keyOf(id, version));
    return item?.workspaceId === workspaceId ? clone(item) : undefined;
  }
  async insertBinding(revision: BindingRevision): Promise<void> {
    this.#insert("BINDING", revision, this.#bindings);
  }
  async saveBinding(revision: BindingRevision): Promise<void> {
    this.#save("BINDING", revision, this.#bindings);
  }
  async binding(
    workspaceId: Uuid,
    projectId: Uuid,
    id: Uuid,
    version: number,
  ): Promise<BindingRevision | undefined> {
    const item = this.#bindings.get(keyOf(id, version));
    return item?.workspaceId === workspaceId && item.projectId === projectId
      ? clone(item)
      : undefined;
  }

  #map(kind: "CONNECTION" | "MAPPING" | "PROFILE" | "BINDING"): Map<string, AnyRevision> {
    if (kind === "CONNECTION") return this.#connections;
    if (kind === "MAPPING") return this.#mappings;
    if (kind === "PROFILE") return this.#profiles;
    return this.#bindings;
  }

  #insert(kind: string, revision: AnyRevision, map: Map<string, AnyRevision>): void {
    const revisionKey = keyOf(revision.id, revision.version);
    if (map.has(revisionKey)) throw new Error(`${kind}_REVISION_EXISTS`);
    const header = this.#headers.get(revision.id);
    if (header) {
      if (
        header.workspaceId !== revision.workspaceId ||
        header.projectId !== ("projectId" in revision ? revision.projectId : undefined)
      )
        throw new Error("CONFIGURATION_SCOPE_MISMATCH");
      if (
        revision.version !==
        Math.max(
          ...[...map.values()]
            .filter((item) => item.id === revision.id)
            .map((item) => item.version),
        ) +
          1
      )
        throw new Error("CONFIGURATION_VERSION_GAP");
    } else {
      const projectId = "projectId" in revision ? revision.projectId : undefined;
      this.#headers.set(revision.id, {
        id: revision.id,
        workspaceId: revision.workspaceId,
        key: revision.key ?? revision.id,
        resourceVersion: revision.resourceVersion,
        ...(projectId === undefined ? {} : { projectId }),
      });
    }
    map.set(revisionKey, clone(revision));
  }

  #save(kind: string, revision: AnyRevision, map: Map<string, AnyRevision>): void {
    const revisionKey = keyOf(revision.id, revision.version);
    const current = map.get(revisionKey);
    if (!current) throw new Error(`${kind}_REVISION_NOT_FOUND`);
    if (revision.contentHash !== current.contentHash)
      throw new Error("IMMUTABLE_CONFIGURATION_CONTENT");
    if (revision.resourceVersion !== current.resourceVersion + 1) throw new Error("ETAG_MISMATCH");
    map.set(revisionKey, clone(revision));
    const header = this.#headers.get(revision.id)!;
    header.resourceVersion = revision.resourceVersion;
  }

  async publish(
    kind: "CONNECTION" | "MAPPING" | "PROFILE",
    workspaceId: Uuid,
    id: Uuid,
    version: number,
    expectedResourceVersion: number,
  ): Promise<PublishableRevision> {
    const map = this.#map(kind) as Map<string, PublishableRevision>;
    const candidate = map.get(keyOf(id, version));
    const header = this.#headers.get(id);
    if (!candidate || !header || header.workspaceId !== workspaceId)
      throw new Error(`${kind}_REVISION_NOT_FOUND`);
    if (
      candidate.resourceVersion !== expectedResourceVersion ||
      header.resourceVersion !== expectedResourceVersion
    )
      throw new Error("ETAG_MISMATCH");
    if (candidate.state !== "VALIDATED") throw new Error("CONFIGURATION_NOT_VALIDATED");
    if (!candidate.validationReportId) throw new Error("VALIDATION_REPORT_REQUIRED");
    const report = this.#reports.get(candidate.validationReportId);
    if (!report || report.status !== "VALID" || report.contentHash !== candidate.contentHash)
      throw new Error("VALIDATION_REPORT_STALE");

    if (
      header.currentPublishedVersion !== undefined &&
      header.currentPublishedVersion !== version
    ) {
      const previousKey = keyOf(id, header.currentPublishedVersion);
      const previous = map.get(previousKey);
      if (previous?.state === "PUBLISHED")
        map.set(previousKey, {
          ...previous,
          state: "RETIRED",
          resourceVersion: previous.resourceVersion + 1,
        });
    }
    const published = {
      ...candidate,
      state: "PUBLISHED" as const,
      resourceVersion: candidate.resourceVersion + 1,
    };
    map.set(keyOf(id, version), published);
    header.currentPublishedVersion = version;
    header.resourceVersion = published.resourceVersion;
    return clone(published);
  }

  async saveValidationReport(report: ValidationReport): Promise<void> {
    if (this.#reports.has(report.id)) throw new Error("VALIDATION_REPORT_IMMUTABLE");
    this.#reports.set(report.id, clone(report));
  }
  async validationReport(scope: ResourceScope, id: Uuid): Promise<ValidationReport | undefined> {
    const report = this.#reports.get(id);
    if (report?.workspaceId !== scope.workspaceId) return undefined;
    if (scope.kind === "PROJECT" && report.projectId !== scope.projectId) return undefined;
    if (scope.kind === "WORKSPACE" && report.projectId !== undefined) return undefined;
    return clone(report);
  }
  async saveConnectionHealth(health: ConnectionHealth): Promise<void> {
    this.#health.set(`${health.workspaceId}:${health.connectionRef.id}`, clone(health));
  }
  async connectionHealth(
    workspaceId: Uuid,
    connectionId: Uuid,
  ): Promise<ConnectionHealth | undefined> {
    return clone(this.#health.get(`${workspaceId}:${connectionId}`));
  }
}

export function classificationReference(key: string, rank: number): ClassificationReference {
  return Object.freeze({ key, rank });
}
