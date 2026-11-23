import { EntitySchema } from "typeorm";

export const PackRegistrationEntity = new EntitySchema({
  name: "PackRegistration",
  tableName: "competency_pack_registrations",
  columns: {
    id: { type: "uuid", primary: true },
    key: { name: "pack_key", type: String },
    version: { name: "pack_version", type: String },
    manifestSchemaVersion: { name: "manifest_schema_version", type: Number },
    coreRange: { name: "required_core_contract_range", type: String },
    manifest: { name: "manifest_payload", type: "jsonb" },
    manifestHash: { name: "manifest_hash", type: String },
    status: { name: "registration_status", type: String },
    registeredAt: { name: "registered_at", type: "timestamptz" },
  },
  uniques: [{ columns: ["key", "version"] }],
});
export const ExtensionRegistrationAttemptEntity = new EntitySchema({
  name: "ExtensionRegistrationAttempt",
  tableName: "extension_registration_attempts",
  columns: {
    id: { type: "uuid", primary: true },
    sourceComponentRef: { name: "source_component_ref", type: String },
    observedKind: { name: "observed_kind", type: String, nullable: true },
    observedKey: { name: "observed_key", type: String, nullable: true },
    observedVersion: { name: "observed_version", type: String, nullable: true },
    observedHash: { name: "observed_hash", type: String },
    outcome: { type: String },
    diagnostics: { type: "jsonb" },
    bootInstanceId: { name: "boot_instance_id", type: String },
    observedAt: { name: "observed_at", type: "timestamptz" },
  },
});
export const WorkTypeDefinitionEntity = new EntitySchema({
  name: "WorkTypeDefinition",
  tableName: "work_type_definitions",
  columns: {
    id: { type: "uuid", primary: true },
    packRegistrationId: { name: "pack_registration_id", type: "uuid" },
    key: { name: "work_type_key", type: String },
    version: { name: "definition_version", type: String },
    intakeSchema: { name: "intake_schema", type: "jsonb" },
    intakeSchemaHash: { name: "intake_schema_hash", type: String },
    requiredCapabilities: { name: "required_capabilities", type: "jsonb" },
    definition: { name: "definition_payload", type: "jsonb" },
    definitionHash: { name: "definition_hash", type: String },
    status: { name: "lifecycle_status", type: String },
    registeredAt: { name: "registered_at", type: "timestamptz" },
  },
  uniques: [{ columns: ["key", "version"] }],
});
export const WorkspaceWorkTypeEntity = new EntitySchema({
  name: "WorkspaceWorkType",
  tableName: "workspace_work_types",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    workTypeKey: { name: "work_type_key", type: String },
    activeDefinitionId: { name: "active_definition_id", type: "uuid" },
    intakeState: { name: "intake_state", type: String },
    changedBy: { name: "changed_by", type: "uuid" },
    changedAt: { name: "changed_at", type: "timestamptz" },
    reason: { type: String },
    rowVersion: { name: "row_version", type: Number },
  },
  uniques: [{ columns: ["workspaceId", "workTypeKey"] }],
});
export const ConnectorRegistrationEntity = new EntitySchema({
  name: "ConnectorRegistration",
  tableName: "connector_registrations",
  columns: {
    id: { type: "uuid", primary: true },
    key: { name: "connector_key", type: String },
    version: { name: "connector_version", type: String },
    manifest: { name: "manifest_payload", type: "jsonb" },
    manifestHash: { name: "manifest_hash", type: String },
    status: { name: "registration_status", type: String },
    registeredAt: { name: "registered_at", type: "timestamptz" },
  },
  uniques: [{ columns: ["key", "version"] }],
});
export const CapabilityContractEntity = new EntitySchema({
  name: "CapabilityContract",
  tableName: "capability_contracts",
  columns: {
    id: { type: "uuid", primary: true },
    key: { name: "capability_key", type: String },
    version: { name: "contract_version", type: String },
    contract: { name: "contract_payload", type: "jsonb" },
    schemaHash: { name: "schema_hash", type: String },
    status: { name: "lifecycle_status", type: String },
    registeredAt: { name: "registered_at", type: "timestamptz" },
  },
  uniques: [{ columns: ["key", "version"] }],
});
export const extensionRegistryEntities = Object.freeze([
  PackRegistrationEntity,
  ExtensionRegistrationAttemptEntity,
  WorkTypeDefinitionEntity,
  WorkspaceWorkTypeEntity,
  ConnectorRegistrationEntity,
  CapabilityContractEntity,
]);
