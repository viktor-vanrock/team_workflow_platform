import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type {
  CanonicalExtensionRegistration,
  ExtensionKind,
  ExtensionRegistrationAttempt,
  RegistrationRepository,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
const table = (kind: ExtensionKind): string =>
  kind === "CompetencyPack"
    ? "competency_pack_registrations"
    : kind === "Connector"
      ? "connector_registrations"
      : "capability_contracts";
const keyColumn = (kind: ExtensionKind): string =>
  kind === "CompetencyPack"
    ? "pack_key"
    : kind === "Connector"
      ? "connector_key"
      : "capability_key";
const versionColumn = (kind: ExtensionKind): string =>
  kind === "CompetencyPack"
    ? "pack_version"
    : kind === "Connector"
      ? "connector_version"
      : "contract_version";

export class TypeOrmExtensionRegistryRepository implements RegistrationRepository {
  constructor(private readonly dataSource: DataSource) {}
  async find(
    kind: ExtensionKind,
    key: string,
    version: string,
  ): Promise<CanonicalExtensionRegistration | undefined> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM ${table(kind)} WHERE ${keyColumn(kind)}=$1 AND ${versionColumn(kind)}=$2`,
      [key, version],
    )) as Row[];
    return this.#map(kind, rows[0]);
  }
  async insert(registration: CanonicalExtensionRegistration): Promise<void> {
    await this.dataSource.transaction(async (manager) => this.#insert(manager, registration));
  }
  async appendAttempt(attempt: ExtensionRegistrationAttempt): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO extension_registration_attempts(id,source_component_ref,observed_kind,observed_key,observed_version,observed_hash,outcome,diagnostics,boot_instance_id,observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        attempt.id,
        attempt.sourceComponentRef,
        attempt.observedKind ?? null,
        attempt.observedKey ?? null,
        attempt.observedVersion ?? null,
        attempt.observedHash,
        attempt.outcome,
        JSON.stringify(attempt.diagnostics),
        attempt.bootInstanceId,
        attempt.observedAt,
      ],
    );
  }
  async list(): Promise<readonly CanonicalExtensionRegistration[]> {
    const values: CanonicalExtensionRegistration[] = [];
    for (const kind of ["CompetencyPack", "Connector", "CapabilityContract"] as const) {
      const rows = (await this.dataSource.query(
        `SELECT * FROM ${table(kind)} ORDER BY ${keyColumn(kind)},${versionColumn(kind)}`,
      )) as Row[];
      values.push(
        ...rows
          .map((row) => this.#map(kind, row))
          .filter((value): value is CanonicalExtensionRegistration => value !== undefined),
      );
    }
    return values;
  }
  async attempts(): Promise<readonly ExtensionRegistrationAttempt[]> {
    const rows = (await this.dataSource.query(
      "SELECT * FROM extension_registration_attempts ORDER BY observed_at,id",
    )) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      sourceComponentRef: String(row.source_component_ref),
      ...(row.observed_kind ? { observedKind: String(row.observed_kind) } : {}),
      ...(row.observed_key ? { observedKey: String(row.observed_key) } : {}),
      ...(row.observed_version ? { observedVersion: String(row.observed_version) } : {}),
      observedHash: String(row.observed_hash) as `sha256:${string}`,
      outcome: row.outcome === "ACCEPTED" ? "ACCEPTED" : "REJECTED",
      diagnostics: Array.isArray(row.diagnostics) ? row.diagnostics.map(String) : [],
      bootInstanceId: String(row.boot_instance_id),
      observedAt: new Date(String(row.observed_at)),
    }));
  }
  async #insert(
    manager: EntityManager,
    registration: CanonicalExtensionRegistration,
  ): Promise<void> {
    if (registration.kind === "CompetencyPack") {
      await manager.query(
        "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8)",
        [
          registration.id,
          registration.key,
          registration.version,
          String((registration.manifest.requires as Record<string, unknown>).coreContracts),
          JSON.stringify(registration.manifest),
          registration.manifestHash,
          registration.status,
          registration.registeredAt,
        ],
      );
      const workTypes = Array.isArray(registration.manifest.workTypes)
        ? (registration.manifest.workTypes as Record<string, unknown>[])
        : [];
      for (const definition of workTypes) {
        const schemaRef = definition.intakeSchemaRef as Record<string, unknown>;
        await manager.query(
          `INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at)
          VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9)`,
          [
            registration.id,
            String(definition.key),
            String(definition.definitionVersion),
            JSON.stringify(schemaRef),
            String(schemaRef.digest),
            JSON.stringify(definition.capabilityRequirements ?? []),
            JSON.stringify(definition),
            sha256(definition as JsonValue),
            registration.registeredAt,
          ],
        );
      }
    } else if (registration.kind === "Connector")
      await manager.query(
        "INSERT INTO connector_registrations(id,connector_key,connector_version,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          registration.id,
          registration.key,
          registration.version,
          JSON.stringify(registration.manifest),
          registration.manifestHash,
          registration.status,
          registration.registeredAt,
        ],
      );
    else
      await manager.query(
        "INSERT INTO capability_contracts(id,capability_key,contract_version,contract_payload,schema_hash,lifecycle_status,registered_at) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)",
        [
          registration.id,
          registration.key,
          registration.version,
          JSON.stringify(registration.manifest),
          registration.manifestHash,
          registration.registeredAt,
        ],
      );
  }
  #map(kind: ExtensionKind, row: Row | undefined): CanonicalExtensionRegistration | undefined {
    if (!row) return undefined;
    const manifest = (row.manifest_payload ?? row.contract_payload) as Record<string, unknown>;
    return {
      id: String(row.id),
      kind,
      key: String(row[keyColumn(kind)]),
      version: String(row[versionColumn(kind)]),
      manifestHash: String(row.manifest_hash ?? row.schema_hash) as `sha256:${string}`,
      manifest,
      status:
        String(row.registration_status ?? row.lifecycle_status) === "DISABLED"
          ? "DISABLED"
          : "REGISTERED",
      registeredAt: new Date(String(row.registered_at)),
    };
  }
}
