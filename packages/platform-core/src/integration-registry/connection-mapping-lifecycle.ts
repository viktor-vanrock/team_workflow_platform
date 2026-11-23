import type { JsonValue, OfflineSchemaRegistry } from "@awp/platform-contracts";

import type { ClassificationCatalog } from "../identity-access/classification-policy.ts";
import type { Clock, IdGenerator, WorkspaceContext } from "../shared/primitives.ts";
import type {
  ConnectionContent,
  ConnectionHealth,
  ConnectionHealthState,
  ConnectionRevision,
  IntegrationConfigurationRepository,
  MappingContent,
  MappingRevision,
  ValidationIssue,
  ValidationReport,
} from "./model.ts";
import {
  assertNoRawSecretFields,
  assertSecretReference,
  collectValidationIssue,
  createValidationReport,
  requireAuthorizationBasis,
  semanticContentHash,
} from "./validation-reports.ts";

export interface ValidationResult<T> {
  readonly revision: T;
  readonly report: ValidationReport;
}

function workspaceMetadata(context: WorkspaceContext, clock: Clock) {
  const authorizationBasis = requireAuthorizationBasis(context, "WORKSPACE");
  return {
    workspaceId: context.scope.workspaceId,
    createdAt: clock.now(),
    createdBy: context.actor.principalId,
    authorizationBasis,
  };
}

function validateEndpoint(
  endpoint: string,
  environmentClass: ConnectionContent["environmentClass"],
): void {
  const parsed = new URL(endpoint);
  if (!new Set(["http:", "https:"]).has(parsed.protocol))
    throw new Error("CONNECTION_ENDPOINT_PROTOCOL_FORBIDDEN");
  if (parsed.username || parsed.password)
    throw new Error("CONNECTION_ENDPOINT_CREDENTIALS_FORBIDDEN");
  if (environmentClass !== "LOCAL" && parsed.protocol !== "https:")
    throw new Error("NON_LOCAL_CONNECTION_REQUIRES_TLS");
}

export class ConnectionMappingLifecycle {
  constructor(
    private readonly repository: IntegrationConfigurationRepository,
    private readonly schemas: OfflineSchemaRegistry,
    private readonly classifications: ClassificationCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createConnection(
    context: WorkspaceContext,
    content: ConnectionContent,
  ): Promise<ConnectionRevision> {
    const metadata = workspaceMetadata(context, this.clock);
    const id = this.ids.next();
    const semantic = {
      key: content.key,
      connectorRef: content.connectorRef,
      environmentClass: content.environmentClass,
      endpoint: content.endpoint,
      serviceIdentitySecretRef: content.serviceIdentitySecretRef,
      quarantineClassificationKey: content.quarantineClassificationKey,
      dataClassificationKey: content.dataClassificationKey,
      ...(content.connectorConfiguration === undefined
        ? {}
        : { connectorConfiguration: content.connectorConfiguration }),
    } as unknown as JsonValue;
    const revision: ConnectionRevision = Object.freeze({
      ...content,
      ...metadata,
      id,
      revisionId: this.ids.next(),
      version: 1,
      resourceVersion: 1,
      state: "DRAFT",
      contentHash: semanticContentHash(semantic),
    });
    await this.repository.insertConnection(revision);
    return revision;
  }

  async validateConnection(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<ValidationResult<ConnectionRevision>> {
    requireAuthorizationBasis(context, "WORKSPACE");
    const candidate = await this.repository.connection(context.scope.workspaceId, id, version);
    if (!candidate || candidate.workspaceId !== context.scope.workspaceId)
      throw new Error("CONNECTION_SCOPE_MISMATCH");
    if (candidate.resourceVersion !== expectedResourceVersion) throw new Error("ETAG_MISMATCH");
    if (candidate.state !== "DRAFT") throw new Error("CONNECTION_NOT_DRAFT");
    const issues: ValidationIssue[] = [];
    collectValidationIssue(issues, "ENDPOINT_INVALID", () =>
      validateEndpoint(candidate.endpoint, candidate.environmentClass),
    );
    collectValidationIssue(issues, "SECRET_REFERENCE_INVALID", () =>
      assertSecretReference(candidate.serviceIdentitySecretRef),
    );
    collectValidationIssue(issues, "CLASSIFICATION_UNKNOWN", () => {
      const data = this.classifications.reference(candidate.dataClassificationKey);
      const quarantine = this.classifications.reference(candidate.quarantineClassificationKey);
      if (quarantine.rank < data.rank) throw new Error("QUARANTINE_CLASSIFICATION_TOO_LOW");
    });
    if (candidate.connectorConfiguration) {
      collectValidationIssue(issues, "CONNECTOR_CONFIGURATION_SCHEMA_INVALID", () =>
        this.schemas.validate(candidate.connectorConfiguration!),
      );
      collectValidationIssue(issues, "RAW_SECRET_FORBIDDEN", () =>
        assertNoRawSecretFields(candidate.connectorConfiguration!.value),
      );
    }
    const report = createValidationReport({
      context,
      subjectKind: "CONNECTION",
      subjectId: id,
      subjectVersion: version,
      contentHash: candidate.contentHash,
      issues,
      clock: this.clock,
      ids: this.ids,
    });
    await this.repository.saveValidationReport(report);
    if (report.status === "INVALID") return Object.freeze({ revision: candidate, report });
    const validated = Object.freeze({
      ...candidate,
      state: "VALIDATED" as const,
      validationReportId: report.id,
      resourceVersion: candidate.resourceVersion + 1,
    });
    await this.repository.saveConnection(validated);
    return Object.freeze({ revision: validated, report });
  }

  async publishConnection(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<ConnectionRevision> {
    requireAuthorizationBasis(context, "WORKSPACE");
    return (await this.repository.publish(
      "CONNECTION",
      context.scope.workspaceId,
      id,
      version,
      expectedResourceVersion,
    )) as ConnectionRevision;
  }

  async updateConnectionHealth(
    context: WorkspaceContext,
    connectionRef: Readonly<{ id: string; version: number }>,
    healthState: ConnectionHealthState,
    reasonCode?: string,
  ): Promise<ConnectionHealth> {
    requireAuthorizationBasis(context, "WORKSPACE");
    const connection = await this.repository.connection(
      context.scope.workspaceId,
      connectionRef.id,
      connectionRef.version,
    );
    if (!connection || connection.workspaceId !== context.scope.workspaceId)
      throw new Error("CONNECTION_SCOPE_MISMATCH");
    const health: ConnectionHealth = Object.freeze({
      workspaceId: context.scope.workspaceId,
      connectionRef,
      healthState,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      checkedAt: this.clock.now(),
    });
    await this.repository.saveConnectionHealth(health);
    return health;
  }

  async createMapping(
    context: WorkspaceContext,
    content: MappingContent,
  ): Promise<MappingRevision> {
    const metadata = workspaceMetadata(context, this.clock);
    const id = this.ids.next();
    const semantic = {
      key: content.key,
      connectorRef: content.connectorRef,
      mapping: content.mapping,
      dataClassificationKey: content.dataClassificationKey,
    } as unknown as JsonValue;
    const revision: MappingRevision = Object.freeze({
      ...content,
      ...metadata,
      id,
      revisionId: this.ids.next(),
      version: 1,
      resourceVersion: 1,
      state: "DRAFT",
      contentHash: semanticContentHash(semantic),
    });
    await this.repository.insertMapping(revision);
    return revision;
  }

  async validateMapping(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<ValidationResult<MappingRevision>> {
    requireAuthorizationBasis(context, "WORKSPACE");
    const candidate = await this.repository.mapping(context.scope.workspaceId, id, version);
    if (!candidate || candidate.workspaceId !== context.scope.workspaceId)
      throw new Error("MAPPING_SCOPE_MISMATCH");
    if (candidate.resourceVersion !== expectedResourceVersion) throw new Error("ETAG_MISMATCH");
    if (candidate.state !== "DRAFT") throw new Error("MAPPING_NOT_DRAFT");
    const issues: ValidationIssue[] = [];
    collectValidationIssue(issues, "MAPPING_SCHEMA_INVALID", () =>
      this.schemas.validate(candidate.mapping),
    );
    collectValidationIssue(issues, "CLASSIFICATION_UNKNOWN", () => {
      this.classifications.reference(candidate.dataClassificationKey);
    });
    const report = createValidationReport({
      context,
      subjectKind: "MAPPING",
      subjectId: id,
      subjectVersion: version,
      contentHash: candidate.contentHash,
      issues,
      clock: this.clock,
      ids: this.ids,
    });
    await this.repository.saveValidationReport(report);
    if (report.status === "INVALID") return Object.freeze({ revision: candidate, report });
    const validated = Object.freeze({
      ...candidate,
      state: "VALIDATED" as const,
      validationReportId: report.id,
      resourceVersion: candidate.resourceVersion + 1,
    });
    await this.repository.saveMapping(validated);
    return Object.freeze({ revision: validated, report });
  }

  async publishMapping(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<MappingRevision> {
    requireAuthorizationBasis(context, "WORKSPACE");
    return (await this.repository.publish(
      "MAPPING",
      context.scope.workspaceId,
      id,
      version,
      expectedResourceVersion,
    )) as MappingRevision;
  }
}
