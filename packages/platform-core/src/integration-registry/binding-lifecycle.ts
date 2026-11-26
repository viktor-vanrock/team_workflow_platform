import type { JsonValue } from "@awp/platform-contracts";

import type { ClassificationCatalog } from "../identity-access/classification-policy.ts";
import type { Clock, IdGenerator, WorkspaceContext } from "../shared/primitives.ts";
import { CapabilityRegistry, satisfiesVersionRange } from "./capability-registry.ts";
import type {
  BindingContent,
  BindingEntry,
  BindingRevision,
  IntegrationConfigurationRepository,
  ValidationIssue,
  ValidationReport,
} from "./model.ts";
import {
  createValidationReport,
  requireAuthorizationBasis,
  semanticContentHash,
} from "./validation-reports.ts";

export interface CapabilityRequirement {
  readonly requirementKey: string;
  readonly featureKey: string;
  readonly capabilityKey: string;
  readonly versionRange: string;
  readonly logicalRole: string;
  readonly operations: readonly string[];
  readonly requirement: "REQUIRED" | "OPTIONAL";
  readonly allowedEnvironmentScopes: readonly string[];
  readonly maxDataClassification: string;
}

export interface CapabilityAvailabilityEntry {
  readonly requirementKey: string;
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly reasonCode?: "CAPABILITY_BINDING_MISSING" | "OPTIONAL_CAPABILITY_UNAVAILABLE";
  readonly bindingEntry?: CapabilityBindingAvailabilityInput;
}

export interface CapabilityBindingAvailabilityInput {
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly logicalRole: string;
  readonly environmentScope: string;
  readonly operations: readonly string[];
}

export function applyBindingValidationReport(
  candidate: BindingRevision,
  report: ValidationReport,
  validatedAt: Date,
): BindingRevision {
  if (
    report.workspaceId !== candidate.workspaceId ||
    report.projectId !== candidate.projectId ||
    report.subjectKind !== "BINDING" ||
    report.subjectRef.id !== candidate.id ||
    report.subjectRef.version !== candidate.version ||
    report.contentHash !== candidate.contentHash
  ) {
    throw new Error("BINDING_VALIDATION_REPORT_SCOPE_MISMATCH");
  }
  if (report.status === "INVALID") return candidate;
  if (Number.isNaN(validatedAt.getTime())) throw new Error("BINDING_VALIDATED_AT_INVALID");
  return Object.freeze({
    ...candidate,
    state: "VALIDATED" as const,
    validationReportId: report.id,
    validatedAt,
    resourceVersion: candidate.resourceVersion + 1,
  });
}

export function cloneBindingRevisionAsDraft(
  input: Readonly<{
    historical: BindingRevision;
    nextVersion: number;
    revisionId: string;
    createdBy: string;
    createdAt: Date;
  }>,
): BindingRevision {
  const historical = input.historical;
  if (
    !["PUBLISHED", "RETIRED"].includes(historical.state) ||
    input.nextVersion <= historical.version ||
    !input.revisionId ||
    !input.createdBy ||
    Number.isNaN(input.createdAt.getTime())
  ) {
    throw new Error("BINDING_ROLLBACK_SOURCE_INVALID");
  }
  return Object.freeze({
    id: historical.id,
    revisionId: input.revisionId,
    workspaceId: historical.workspaceId,
    projectId: historical.projectId,
    ...(historical.key === undefined ? {} : { key: historical.key }),
    version: input.nextVersion,
    resourceVersion: 1,
    state: "DRAFT",
    dataClassificationKey: historical.dataClassificationKey,
    entries: structuredClone(historical.entries),
    configurationRefs: structuredClone(historical.configurationRefs ?? []),
    resourceRefs: structuredClone(historical.resourceRefs ?? []),
    contentHash: historical.contentHash,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    authorizationBasis: historical.authorizationBasis,
  });
}

export function evaluateCapabilityRequirements(
  requirements: readonly CapabilityRequirement[],
  entries: readonly CapabilityBindingAvailabilityInput[],
): {
  readonly publishable: boolean;
  readonly availability: readonly CapabilityAvailabilityEntry[];
} {
  const availability = requirements.map((requirement): CapabilityAvailabilityEntry => {
    const bindingEntry = entries.find(
      (entry) =>
        entry.capabilityKey === requirement.capabilityKey &&
        entry.logicalRole === requirement.logicalRole &&
        satisfiesVersionRange(entry.exactContractVersion, requirement.versionRange) &&
        (requirement.allowedEnvironmentScopes.includes(entry.environmentScope) ||
          (entry.environmentScope === "NON_PROD" &&
            requirement.allowedEnvironmentScopes.includes("NON_PRODUCTION"))) &&
        requirement.operations.every((operation) => entry.operations.includes(operation)),
    );
    if (bindingEntry)
      return Object.freeze({
        requirementKey: requirement.requirementKey,
        status: "AVAILABLE",
        bindingEntry,
      });
    return Object.freeze({
      requirementKey: requirement.requirementKey,
      status: "UNAVAILABLE",
      reasonCode:
        requirement.requirement === "REQUIRED"
          ? "CAPABILITY_BINDING_MISSING"
          : "OPTIONAL_CAPABILITY_UNAVAILABLE",
    });
  });
  return Object.freeze({
    publishable: availability.every(
      (entry, index) =>
        entry.status === "AVAILABLE" || requirements[index]!.requirement === "OPTIONAL",
    ),
    availability: Object.freeze(availability),
  });
}

export interface ResolvedBindingEntry {
  readonly entry: BindingEntry;
  readonly profile: Awaited<ReturnType<IntegrationConfigurationRepository["profile"]>> & {};
  readonly connection: Awaited<ReturnType<IntegrationConfigurationRepository["connection"]>> & {};
  readonly mapping?: Awaited<ReturnType<IntegrationConfigurationRepository["mapping"]>> & {};
}

export class BindingLifecycle {
  constructor(
    private readonly repository: IntegrationConfigurationRepository,
    private readonly capabilities: CapabilityRegistry,
    private readonly classifications: ClassificationCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createBinding(
    context: WorkspaceContext,
    content: BindingContent,
  ): Promise<BindingRevision> {
    const authorizationBasis = requireAuthorizationBasis(context, "PROJECT");
    if (context.scope.kind !== "PROJECT") throw new Error("SCOPE_PROJECT_REQUIRED");
    const scope = context.scope;
    if (
      content.entries.some(
        ({ environmentScope }) => !["LOCAL", "NON_PROD", "PREPROD"].includes(environmentScope),
      )
    ) {
      throw new Error("BINDING_PRODUCTION_SCOPE_FORBIDDEN");
    }
    const tupleSet = new Set<string>();
    for (const entry of content.entries) {
      const tuple = `${entry.logicalRole}\0${entry.capabilityKey}\0${entry.exactContractVersion}\0${entry.environmentScope}`;
      if (tupleSet.has(tuple)) throw new Error("BINDING_ENTRY_TUPLE_DUPLICATE");
      tupleSet.add(tuple);
      const profile = await this.repository.profile(
        scope.workspaceId,
        entry.profileRef.id,
        entry.profileRef.version,
      );
      if (!profile || profile.workspaceId !== scope.workspaceId)
        throw new Error("PROFILE_SCOPE_MISMATCH");
    }
    const id = this.ids.next();
    const key = content.key ?? `binding-${id}`;
    const semantic = {
      key,
      dataClassificationKey: content.dataClassificationKey,
      entries: content.entries,
      configurationRefs: content.configurationRefs ?? [],
      resourceRefs: content.resourceRefs ?? [],
    } as unknown as JsonValue;
    const revision: BindingRevision = Object.freeze({
      ...content,
      key,
      id,
      revisionId: this.ids.next(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      version: 1,
      resourceVersion: 1,
      state: "DRAFT",
      contentHash: semanticContentHash(semantic),
      createdAt: this.clock.now(),
      createdBy: context.actor.principalId,
      authorizationBasis,
    });
    await this.repository.insertBinding(revision);
    return revision;
  }

  async validateBinding(
    context: WorkspaceContext,
    id: string,
    version: number,
    expectedResourceVersion: number,
    requirements: readonly CapabilityRequirement[],
  ): Promise<{
    readonly revision: BindingRevision;
    readonly report: ValidationReport;
    readonly availability: ReturnType<typeof evaluateCapabilityRequirements>;
  }> {
    requireAuthorizationBasis(context, "PROJECT");
    if (context.scope.kind !== "PROJECT") throw new Error("SCOPE_PROJECT_REQUIRED");
    const scope = context.scope;
    const candidate = await this.repository.binding(
      scope.workspaceId,
      scope.projectId,
      id,
      version,
    );
    if (
      !candidate ||
      candidate.workspaceId !== scope.workspaceId ||
      candidate.projectId !== scope.projectId
    )
      throw new Error("BINDING_SCOPE_MISMATCH");
    if (candidate.resourceVersion !== expectedResourceVersion) throw new Error("ETAG_MISMATCH");
    if (candidate.state !== "DRAFT") throw new Error("BINDING_NOT_DRAFT");
    const issues: ValidationIssue[] = [];
    let resolved: readonly ResolvedBindingEntry[] = [];
    try {
      resolved = await this.resolveExactChain(context, candidate);
    } catch (error) {
      issues.push({
        code: "BINDING_CHAIN_INVALID",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const inputs: CapabilityBindingAvailabilityInput[] = resolved.map(({ entry, profile }) => {
      const configured = profile.capabilityConfigurations.find(
        (configuration) =>
          configuration.capabilityKey === entry.capabilityKey &&
          configuration.exactContractVersion === entry.exactContractVersion,
      );
      return {
        capabilityKey: entry.capabilityKey,
        exactContractVersion: entry.exactContractVersion,
        logicalRole: entry.logicalRole,
        environmentScope: entry.environmentScope,
        operations: configured?.operations.map((operation) => operation.operation) ?? [],
      };
    });
    const availability = evaluateCapabilityRequirements(requirements, inputs);
    if (!availability.publishable)
      issues.push({
        code: "REQUIRED_CAPABILITY_UNAVAILABLE",
        message: "At least one required capability is unavailable",
      });
    const report = createValidationReport({
      context,
      subjectKind: "BINDING",
      subjectId: id,
      subjectVersion: version,
      contentHash: candidate.contentHash,
      issues,
      clock: this.clock,
      ids: this.ids,
    });
    await this.repository.saveValidationReport(report);
    if (report.status === "INVALID")
      return Object.freeze({ revision: candidate, report, availability });
    const validated = applyBindingValidationReport(candidate, report, this.clock.now());
    await this.repository.saveBinding(validated);
    return Object.freeze({ revision: validated, report, availability });
  }

  async resolveExactChain(
    context: WorkspaceContext,
    binding: BindingRevision,
  ): Promise<readonly ResolvedBindingEntry[]> {
    requireAuthorizationBasis(context, "PROJECT");
    if (context.scope.kind !== "PROJECT") throw new Error("SCOPE_PROJECT_REQUIRED");
    if (
      binding.workspaceId !== context.scope.workspaceId ||
      binding.projectId !== context.scope.projectId
    )
      throw new Error("BINDING_SCOPE_MISMATCH");
    this.classifications.reference(binding.dataClassificationKey);
    const resolved: ResolvedBindingEntry[] = [];
    for (const entry of [...binding.entries].sort((left, right) =>
      `${left.logicalRole}:${left.capabilityKey}`.localeCompare(
        `${right.logicalRole}:${right.capabilityKey}`,
      ),
    )) {
      const profile = await this.repository.profile(
        binding.workspaceId,
        entry.profileRef.id,
        entry.profileRef.version,
      );
      if (!profile || profile.workspaceId !== binding.workspaceId || profile.state !== "PUBLISHED")
        throw new Error("PROFILE_NOT_PUBLISHED");
      const configuration = profile.capabilityConfigurations.find(
        (candidate) =>
          candidate.capabilityKey === entry.capabilityKey &&
          candidate.exactContractVersion === entry.exactContractVersion,
      );
      if (!configuration) throw new Error("PROFILE_CAPABILITY_MISMATCH");
      if (!configuration.environmentScopes.includes(entry.environmentScope))
        throw new Error("PROFILE_ENVIRONMENT_SCOPE_MISMATCH");
      const ceiling = this.classifications.reference(entry.classificationCeilingKey);
      const bindingClassification = this.classifications.reference(binding.dataClassificationKey);
      if (!this.classifications.permits(ceiling, bindingClassification))
        throw new Error("BINDING_CLASSIFICATION_EXCEEDS_CEILING");
      this.capabilities.implementation(
        profile.connectorRef,
        entry.capabilityKey,
        entry.exactContractVersion,
      );
      const connection = await this.repository.connection(
        binding.workspaceId,
        profile.connectionRef.id,
        profile.connectionRef.version,
      );
      if (
        !connection ||
        connection.workspaceId !== binding.workspaceId ||
        connection.state !== "PUBLISHED"
      )
        throw new Error("CONNECTION_NOT_PUBLISHED");
      let mapping;
      if (profile.mappingRef) {
        mapping = await this.repository.mapping(
          binding.workspaceId,
          profile.mappingRef.id,
          profile.mappingRef.version,
        );
        if (
          !mapping ||
          mapping.workspaceId !== binding.workspaceId ||
          mapping.state !== "PUBLISHED"
        )
          throw new Error("MAPPING_NOT_PUBLISHED");
        if (
          profile.mappingRef.contentHash &&
          mapping.contentHash !== profile.mappingRef.contentHash
        )
          throw new Error("MAPPING_HASH_MISMATCH");
      }
      resolved.push(
        Object.freeze({
          entry,
          profile,
          connection,
          ...(mapping === undefined ? {} : { mapping }),
        }),
      );
    }
    return Object.freeze(resolved);
  }
}
