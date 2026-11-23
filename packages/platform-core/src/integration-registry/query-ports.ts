import type {
  BindingRevision,
  ConfigurationState,
  ConnectionHealthState,
  MappingRevision,
  ProfileRevision,
} from "./model.ts";

export type MappingHealthState = "CURRENT" | "NEEDS_REVIEW" | "UNAVAILABLE";

export interface ProfileMappingHealth {
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly profileState: ConfigurationState | "MISSING";
  readonly mappingRef?: Readonly<{ id: string; version: number }>;
  readonly mappingState: ConfigurationState | "NOT_REQUIRED" | "MISSING";
  readonly connectionHealthState: ConnectionHealthState;
  readonly health: MappingHealthState;
}

export interface BindingHealth {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly bindingState: ConfigurationState;
  readonly health: MappingHealthState;
  readonly profiles: readonly ProfileMappingHealth[];
  readonly resourceVersion: number;
}

export interface IntegrationConfigurationQueryPort {
  binding(
    workspaceId: string,
    projectId: string,
    id: string,
    version: number,
  ): Promise<BindingRevision | undefined>;
  profile(workspaceId: string, id: string, version: number): Promise<ProfileRevision | undefined>;
  mapping(workspaceId: string, id: string, version: number): Promise<MappingRevision | undefined>;
  bindingHealth(
    workspaceId: string,
    projectId: string,
    bindingRef: Readonly<{ id: string; version: number }>,
  ): Promise<BindingHealth | undefined>;
}
