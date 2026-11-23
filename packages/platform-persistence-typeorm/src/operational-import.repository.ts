import type { DataSource, EntityManager } from "typeorm";

type Row = Record<string, unknown>;
export class TypeOrmOperationalImportRepository {
  constructor(private readonly source: DataSource) {}
  async findByAuthority(
    connectionHeaderId: string,
    externalEntityType: string,
    externalEntityId: string,
  ): Promise<Row | undefined> {
    return (
      (await this.source.query(
        "SELECT * FROM operational_import_intents WHERE connection_header_id=$1 AND external_entity_type=$2 AND external_entity_id=$3",
        [connectionHeaderId, externalEntityType, externalEntityId],
      )) as Row[]
    )[0];
  }
  async advance(
    manager: EntityManager,
    id: string,
    expectedState: string,
    nextState: string,
    patch: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const rows = (await manager.query(
      "UPDATE operational_import_intents SET state=$3,reason_code=$4,result_work_item_id=$5,result_binding_id=$6,adopted_at=$7,updated_at=clock_timestamp(),resource_version=resource_version+1 WHERE id=$1 AND state=$2 RETURNING id",
      [
        id,
        expectedState,
        nextState,
        patch.reasonCode ?? null,
        patch.resultWorkItemId ?? null,
        patch.resultBindingId ?? null,
        patch.adoptedAt ?? null,
      ],
    )) as Row[];
    if (rows.length !== 1) throw new Error("IMPORT_STATE_CONFLICT");
  }
  async converge(
    manager: EntityManager,
    input: Readonly<{
      id: string;
      workspaceId: string;
      projectId: string;
      connectionHeaderId: string;
      externalEntityType: string;
      externalEntityId: string;
      externalDisplayKey: string;
      connectionRef: unknown;
      profileRef: unknown;
      discoverySource: string;
      discoveryPayloadHash: string;
      authoritativeReadHash: string;
      externalRevisionToken: string;
      externalCreatorId: string;
      projectDiscriminator: string;
      correlationId: string;
      causationId: string;
    }>,
  ): Promise<Row> {
    const rows = (await manager.query(
      "INSERT INTO operational_import_intents(id,workspace_id,project_id,connection_header_id,connection_ref,profile_ref,external_entity_type,external_entity_id,external_display_key,discovery_source,discovery_payload_hash,authoritative_read_hash,external_revision_token,external_creator_id,project_discriminator,state,correlation_id,causation_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DISCOVERED',$16,$17,clock_timestamp(),clock_timestamp()) ON CONFLICT(connection_header_id,external_entity_type,external_entity_id) DO UPDATE SET updated_at=operational_import_intents.updated_at RETURNING *",
      [
        input.id,
        input.workspaceId,
        input.projectId,
        input.connectionHeaderId,
        JSON.stringify(input.connectionRef),
        JSON.stringify(input.profileRef),
        input.externalEntityType,
        input.externalEntityId,
        input.externalDisplayKey,
        input.discoverySource,
        input.discoveryPayloadHash,
        input.authoritativeReadHash,
        input.externalRevisionToken,
        input.externalCreatorId,
        input.projectDiscriminator,
        input.correlationId,
        input.causationId,
      ],
    )) as Row[];
    return rows[0]!;
  }
}
