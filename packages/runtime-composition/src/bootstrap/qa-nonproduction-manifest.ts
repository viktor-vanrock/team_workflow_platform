import { createHash, randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

import {
  qaCompetencyManifestV15,
  qaValidationWorkTypeDefinitionV15,
} from "@awp/competency-qa/node";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

/** Registers an immutable definition; activation for a workspace remains a separate action. */
export async function registerQaNonproductionManifest(
  source: DataSource,
  environment: string | undefined,
): Promise<void> {
  if (environment !== "dev") throw new Error("QA_NONPRODUCTION_MANIFEST_DEV_REQUIRED");
  await source.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "qa-nonproduction-manifest-1.5.0",
    ]);
    const manifestHash = hash(qaCompetencyManifestV15);
    const definition = qaValidationWorkTypeDefinitionV15;
    const definitionHash = hash(definition);
    await manager.query(
      `INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at)
       VALUES($1,'competency-qa','1.5.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',clock_timestamp())
       ON CONFLICT(pack_key,pack_version) DO NOTHING`,
      [randomUUID(), JSON.stringify(qaCompetencyManifestV15), manifestHash],
    );
    const packs = (await manager.query(
      "SELECT id,manifest_hash,registration_status FROM competency_pack_registrations WHERE pack_key='competency-qa' AND pack_version='1.5.0'",
    )) as readonly { id: string; manifest_hash: string; registration_status: string }[];
    const pack = packs[0];
    if (
      packs.length !== 1 ||
      !pack ||
      pack.manifest_hash !== manifestHash ||
      pack.registration_status !== "REGISTERED"
    )
      throw new Error("QA_NONPRODUCTION_MANIFEST_CONFLICT");
    await manager.query(
      `INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at)
       VALUES($1,$2,'qa.validation','1.5.0',$3,$4,$5,$6,$7,'ACTIVE',clock_timestamp())
       ON CONFLICT(work_type_key,definition_version) DO NOTHING`,
      [
        randomUUID(),
        pack.id,
        JSON.stringify(definition.intakeSchemaRef),
        definition.intakeSchemaRef.digest,
        JSON.stringify(definition.capabilityRequirements),
        JSON.stringify(definition),
        definitionHash,
      ],
    );
    const definitions = (await manager.query(
      "SELECT pack_registration_id,definition_hash,lifecycle_status FROM work_type_definitions WHERE work_type_key='qa.validation' AND definition_version='1.5.0'",
    )) as readonly {
      pack_registration_id: string;
      definition_hash: string;
      lifecycle_status: string;
    }[];
    const stored = definitions[0];
    if (
      definitions.length !== 1 ||
      !stored ||
      stored.pack_registration_id !== pack.id ||
      stored.definition_hash !== definitionHash ||
      stored.lifecycle_status !== "ACTIVE"
    )
      throw new Error("QA_NONPRODUCTION_DEFINITION_CONFLICT");
  });
}
