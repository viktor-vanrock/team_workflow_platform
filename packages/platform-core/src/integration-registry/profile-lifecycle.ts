import {
  designContractRegistry,
  type JsonValue,
  type OfflineSchemaRegistry,
} from "@awp/platform-contracts";

import type { ClassificationCatalog } from "../identity-access/classification-policy.ts";
import type { Clock, IdGenerator, WorkspaceContext } from "../shared/primitives.ts";
import { CapabilityRegistry, intersectOperationStrategies } from "./capability-registry.ts";
import type {
  IntegrationConfigurationRepository,
  ProfileContent,
  ProfileRevision,
  ValidationIssue,
  ValidationReport,
} from "./model.ts";
import {
  collectValidationIssue,
  createValidationReport,
  requireAuthorizationBasis,
  semanticContentHash,
} from "./validation-reports.ts";

export class ProfileLifecycle {
  constructor(
    private readonly repository: IntegrationConfigurationRepository,
    private readonly capabilities: CapabilityRegistry,
    private readonly classifications: ClassificationCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly schemas: OfflineSchemaRegistry = designContractRegistry,
  ) {}

  async createProfile(
    context: WorkspaceContext,
    content: ProfileContent,
  ): Promise<ProfileRevision> {
    const authorizationBasis = requireAuthorizationBasis(context, "WORKSPACE");
    const connection = await this.repository.connection(
      context.scope.workspaceId,
      content.connectionRef.id,
      content.connectionRef.version,
    );
    if (!connection || connection.workspaceId !== context.scope.workspaceId)
      throw new Error("CONNECTION_SCOPE_MISMATCH");
    if (
      connection.connectorRef.key !== content.connectorRef.key ||
      connection.connectorRef.version !== content.connectorRef.version
    )
      throw new Error("PROFILE_CONNECTOR_MISMATCH");
    if (content.mappingRef) {
      const mapping = await this.repository.mapping(
        context.scope.workspaceId,
        content.mappingRef.id,
        content.mappingRef.version,
      );
      if (!mapping || mapping.workspaceId !== context.scope.workspaceId)
        throw new Error("MAPPING_SCOPE_MISMATCH");
      if (
        mapping.connectorRef.key !== content.connectorRef.key ||
        mapping.connectorRef.version !== content.connectorRef.version
      )
        throw new Error("MAPPING_CONNECTOR_MISMATCH");
    }
    const id = this.ids.next();
    const semantic = {
      key: content.key,
      connectorRef: content.connectorRef,
      connectionRef: content.connectionRef,
      ...(content.mappingRef === undefined ? {} : { mappingRef: content.mappingRef }),
      dataClassificationKey: content.dataClassificationKey,
      capabilityConfigurations: content.capabilityConfigurations,
      ...(content.profileConfiguration === undefined
        ? {}
        : { profileConfiguration: content.profileConfiguration }),
    } as unknown as JsonValue;
    const revision: ProfileRevision = Object.freeze({
      ...content,
      id,
      revisionId: this.ids.next(),
      workspaceId: context.scope.workspaceId,
      version: 1,
      resourceVersion: 1,
      state: "DRAFT",
      contentHash: semanticContentHash(semantic),
      createdAt: this.clock.now(),
      createdBy: context.actor.principalId,
      authorizationBasis,
    });
    await this.repository.insertProfile(revision);
    return revision;
  }

  async validateProfile(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<{ readonly revision: ProfileRevision; readonly report: ValidationReport }> {
    requireAuthorizationBasis(context, "WORKSPACE");
    const candidate = await this.repository.profile(context.scope.workspaceId, id, version);
    if (!candidate || candidate.workspaceId !== context.scope.workspaceId)
      throw new Error("PROFILE_SCOPE_MISMATCH");
    if (candidate.resourceVersion !== expectedResourceVersion) throw new Error("ETAG_MISMATCH");
    if (candidate.state !== "DRAFT") throw new Error("PROFILE_NOT_DRAFT");
    const issues: ValidationIssue[] = [];
    const connection = await this.repository.connection(
      candidate.workspaceId,
      candidate.connectionRef.id,
      candidate.connectionRef.version,
    );
    if (
      !connection ||
      connection.workspaceId !== candidate.workspaceId ||
      connection.state !== "PUBLISHED"
    ) {
      issues.push({
        code: "CONNECTION_NOT_PUBLISHED",
        message: "The exact same-Workspace Connection revision must be published",
      });
    } else {
      if (
        connection.connectorRef.key !== candidate.connectorRef.key ||
        connection.connectorRef.version !== candidate.connectorRef.version
      )
        issues.push({
          code: "PROFILE_CONNECTOR_MISMATCH",
          message: "Profile and Connection must select the same Connector",
        });
    }

    if (candidate.mappingRef) {
      const mapping = await this.repository.mapping(
        candidate.workspaceId,
        candidate.mappingRef.id,
        candidate.mappingRef.version,
      );
      if (
        !mapping ||
        mapping.workspaceId !== candidate.workspaceId ||
        mapping.state !== "PUBLISHED"
      )
        issues.push({
          code: "MAPPING_NOT_PUBLISHED",
          message: "The exact same-Workspace Mapping revision must be published",
        });
      else {
        if (
          mapping.connectorRef.key !== candidate.connectorRef.key ||
          mapping.connectorRef.version !== candidate.connectorRef.version
        )
          issues.push({
            code: "MAPPING_CONNECTOR_MISMATCH",
            message: "Mapping and Profile must select the same Connector",
          });
        if (
          candidate.mappingRef.contentHash &&
          candidate.mappingRef.contentHash !== mapping.contentHash
        )
          issues.push({
            code: "MAPPING_HASH_MISMATCH",
            message: "Pinned Mapping content hash does not match",
          });
      }
    }

    collectValidationIssue(issues, "PROFILE_CLASSIFICATION_UNKNOWN", () => {
      this.classifications.reference(candidate.dataClassificationKey);
    });
    if (candidate.profileConfiguration)
      collectValidationIssue(issues, "PROFILE_CONFIGURATION_SCHEMA_INVALID", () => {
        this.schemas.validate(candidate.profileConfiguration!);
      });

    const seenCapabilities = new Set<string>();
    for (const configuration of candidate.capabilityConfigurations) {
      const tuple = `${configuration.capabilityKey}@${configuration.exactContractVersion}`;
      if (seenCapabilities.has(tuple))
        issues.push({
          code: "DUPLICATE_PROFILE_CAPABILITY",
          message: `Duplicate capability configuration ${tuple}`,
        });
      seenCapabilities.add(tuple);
      collectValidationIssue(issues, "EXTERNAL_SCOPE_SCHEMA_INVALID", () => {
        this.schemas.validate(configuration.externalScope);
      });
      let implementation;
      try {
        implementation = this.capabilities.implementation(
          candidate.connectorRef,
          configuration.capabilityKey,
          configuration.exactContractVersion,
        );
      } catch (error) {
        issues.push({
          code: "CAPABILITY_IMPLEMENTATION_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      let contract;
      try {
        contract = this.capabilities.contract(
          configuration.capabilityKey,
          configuration.exactContractVersion,
        );
      } catch (error) {
        issues.push({
          code: "CAPABILITY_CONTRACT_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      for (const operation of configuration.operations) {
        const contractOperation = contract.operations.find(
          (entry) => entry.key === operation.operation,
        );
        const implementationOperation = implementation.operations.find(
          (entry) => entry.key === operation.operation,
        );
        if (!contractOperation || !implementationOperation) {
          issues.push({
            code: "CAPABILITY_OPERATION_UNAVAILABLE",
            message: `Operation ${operation.operation} is unavailable`,
          });
          continue;
        }
        if (contractOperation.effect !== operation.effect)
          issues.push({
            code: "CAPABILITY_EFFECT_MISMATCH",
            message: `Effect mismatch for ${operation.operation}`,
          });
        const intersection = intersectOperationStrategies(
          contractOperation,
          implementationOperation,
          operation,
        );
        if (!intersection.accepted)
          issues.push({
            code: intersection.reasonCode ?? "STRATEGY_INTERSECTION_EMPTY",
            message: `Selected strategies are unavailable for ${operation.operation}`,
          });
      }
      for (const classificationKey of configuration.allowedDataClassifications) {
        collectValidationIssue(issues, "CLASSIFICATION_UNKNOWN", () => {
          this.classifications.reference(classificationKey);
        });
      }
      if (connection) {
        const quarantineRank = this.classifications.reference(
          connection.quarantineClassificationKey,
        ).rank;
        const maximumInboundRank = Math.max(
          ...configuration.allowedDataClassifications.map(
            (key) => this.classifications.reference(key).rank,
          ),
        );
        if (Number.isFinite(maximumInboundRank) && quarantineRank < maximumInboundRank) {
          issues.push({
            code: "QUARANTINE_CLASSIFICATION_TOO_LOW",
            message:
              "Connection quarantine rank must cover every inbound classification allowed by the Profile",
          });
        }
      }
    }

    const report = createValidationReport({
      context,
      subjectKind: "PROFILE",
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
    await this.repository.saveProfile(validated);
    return Object.freeze({ revision: validated, report });
  }

  async publishProfile(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<ProfileRevision> {
    requireAuthorizationBasis(context, "WORKSPACE");
    return (await this.repository.publish(
      "PROFILE",
      context.scope.workspaceId,
      id,
      version,
      expectedResourceVersion,
    )) as ProfileRevision;
  }
}
