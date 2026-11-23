import type { SchemaReference, WorkspaceContext } from "@awp/platform-core";

export * from "./confirmation-hook.ts";
export * from "./external-command-lifecycle-hook.ts";

export type RequirementLevel = "REQUIRED" | "OPTIONAL";
export type EnvironmentScope = "LOCAL" | "NON_PRODUCTION";

export interface CapabilityRequirement {
  readonly requirementKey: string;
  readonly capabilityKey: string;
  readonly versionRange: string;
  readonly logicalRole: string;
  readonly operations: readonly string[];
  readonly requirement: RequirementLevel;
  readonly featureKey: string;
  readonly allowedEnvironmentScopes: readonly EnvironmentScope[];
  readonly maxDataClassification: string;
}

export interface UiContributionDeclaration {
  readonly slot: "WORK_ITEM_DETAIL_TAB" | "WORK_ITEM_ACTION";
  readonly routeSegment: string;
  readonly componentRef: string;
}

export interface WorkTypeDefinition {
  readonly key: string;
  readonly definitionVersion: string;
  readonly displayName: string;
  readonly intakeSchemaRef: SchemaReference;
  readonly applicationComponentRef: string;
  readonly migrationNamespace: string;
  readonly uiContributions: readonly UiContributionDeclaration[];
  readonly capabilityRequirements: readonly CapabilityRequirement[];
}

export interface CompetencyPackManifest {
  readonly apiVersion: "awp.platform/v1";
  readonly kind: "CompetencyPack";
  readonly metadata: Readonly<{ key: string; version: string; displayName: string }>;
  readonly requires: Readonly<{ coreContracts: string; competencySdk: string }>;
  readonly workTypes: readonly WorkTypeDefinition[];
  readonly events?: readonly Readonly<{
    eventType: string;
    payloadVersion: number;
    payloadSchemaRef: SchemaReference;
  }>[];
}

export interface PackIntakeHandler<TInput, TExtension> {
  submit(context: WorkspaceContext, input: TInput): Promise<TExtension>;
}

export interface PackDetailHandler<TExtension> {
  get(context: WorkspaceContext, workItemId: string): Promise<TExtension | undefined>;
}
