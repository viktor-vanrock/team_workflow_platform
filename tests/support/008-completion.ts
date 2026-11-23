import { randomUUID } from "node:crypto";

import type { QaVerdictCompletionController } from "../../apps/api/src/extensions/qa-verdict-completion.controller.ts";
import {
  qaAggregateSnapshotHash,
  type QaExactReference,
} from "../../packages/competency-qa/src/node.ts";
import { TypeOrmOperationalAuthorityRepository } from "../../packages/platform-persistence-typeorm/src/index.ts";
import type { QaCompletionPins } from "../../packages/runtime-composition/src/pilot/completion-configuration.ts";
import {
  executeUs3CleanPass,
  reviewUs3CleanPass,
  us3Actor,
  type Us3DatabaseFixture,
} from "./002-us3-database.ts";

export async function prepare008VerdictInventory(f: Us3DatabaseFixture) {
  const execution = await executeUs3CleanPass(f);
  await reviewUs3CleanPass(f, execution.executionSetHash);
  const [plan] = (await f.source.query(
    'SELECT current_version_id AS id,current_version AS version,current_content_hash AS "contentHash" FROM qa_required_session_plans WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3',
    [f.workspaceId, f.projectId, f.workItemId],
  )) as [QaExactReference];
  const aggregate = qaAggregateSnapshotHash({ workItemId: f.workItemId } as never);
  await f.source.query(
    "UPDATE qa_request_extensions SET current_required_session_plan_version_id=$1,current_required_session_plan_content_hash=$2,adjudicative_aggregate_hash=$3 WHERE workspace_id=$4 AND project_id=$5 AND work_item_id=$6",
    [plan.id, plan.contentHash, aggregate, f.workspaceId, f.projectId, f.workItemId],
  );
  return { aggregate, execution, plan };
}
export async function prepare008CompletionProof(
  f: Us3DatabaseFixture,
  controller: QaVerdictCompletionController,
) {
  const { aggregate } = await prepare008VerdictInventory(f);
  const verdict = await controller.createVerdict(
    f.request as never,
    f.workspaceId,
    f.projectId,
    f.workItemId,
    {
      verdict: "PASS",
      residualRisk: { statement: "Reviewed residual risk", classification: "LOW" },
      expectedAggregateSnapshotHash: aggregate,
    },
    f.response,
  );
  await controller.signVerdict(
    f.request as never,
    f.workspaceId,
    f.projectId,
    f.workItemId,
    verdict.verdictId,
    'W/"1"',
    f.response,
  );
  const assessment = await controller.assessDod(
    f.request as never,
    f.workspaceId,
    f.projectId,
    f.workItemId,
    {
      expectedAggregateSnapshotHash: aggregate,
      verdictRef: {
        id: verdict.verdictId,
        version: verdict.version,
        contentHash: verdict.contentHash,
      },
    },
  );
  if (assessment.state !== "READY_TO_CLOSE") throw new Error("FIXTURE_COMPLETION_NOT_READY");
  return {
    id: assessment.assessmentId,
    version: assessment.version,
    contentHash: assessment.contentHash,
  };
}

export async function seed008CompletionConfiguration(
  f: Us3DatabaseFixture,
): Promise<QaCompletionPins> {
  const insert = async (
    table: "connection" | "connector_mapping" | "connector_profile" | "project_integration_binding",
    content: Record<string, unknown>,
  ) => {
    const ref = {
      id: randomUUID(),
      version: 1,
      contentHash: qaAggregateSnapshotHash(content as never),
    };
    const binding = table === "project_integration_binding";
    await f.source.query(
      `INSERT INTO ${table}_headers(id,workspace_id,key,current_published_version${binding ? ",project_id" : ""}) VALUES($1,$2,$3,1${binding ? ",$4" : ""})`,
      [ref.id, f.workspaceId, ref.id, ...(binding ? [f.projectId] : [])],
    );
    await f.source.query(
      `INSERT INTO ${table}_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at${binding ? ",project_id" : ""}) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now()${binding ? ",$6" : ""})`,
      [
        randomUUID(),
        f.workspaceId,
        ref.id,
        content,
        ref.contentHash,
        ...(binding ? [f.projectId] : []),
      ],
    );
    return ref;
  };
  const connectorKey = "jira.operational-authority";
  const authorityScopeKey = `completion.${randomUUID()}`;
  const connectionRef = await insert("connection", { connectorKey, projectId: "APPROVED-SANDBOX" });
  const mappingRef = await insert("connector_mapping", { connectorKey, authorityScopeKey });
  const profileRef = await insert("connector_profile", {
    connectorKey,
    mappingRef,
    connectionRef,
    capabilityConfigurations: [
      {
        capabilityKey: "operational-work-item",
        exactContractVersion: "1.0.0",
        environmentScopes: ["NON_PROD"],
        allowedDataClassifications: ["PUBLIC", "INTERNAL"],
        operations: [{ operation: "request.transition", effect: "WRITE" }],
      },
    ],
  });
  const bindingRef = await insert("project_integration_binding", {
    entries: [
      {
        logicalRole: "QA_REQUEST_AUTHORITY",
        capabilityKey: "operational-work-item",
        exactContractVersion: "1.0.0",
        environmentScope: "NON_PROD",
        classificationCeilingKey: "INTERNAL",
        profileRef,
        externalScope: {
          value: {
            authorityScopeKey,
            environmentScope: "NON_PROD",
            allowedEntityKinds: ["REQUEST"],
          },
        },
      },
    ],
  });
  return {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    bindingRef,
    profileRef,
    mappingRef,
    connectionRef,
    authorityScopeKey,
    maximumClassificationKey: "INTERNAL",
    maximumProjectionAgeMs: 300_000,
    allowedFromStates: ["READY", "REVIEW"],
    externalProjectId: "APPROVED-SANDBOX",
  };
}

export async function observe008Completion(f: Us3DatabaseFixture, pins: QaCompletionPins) {
  const [input] = (await f.source.query(
    "SELECT external_request_id FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version DESC LIMIT 1",
    [f.workspaceId, f.projectId, f.workItemId],
  )) as [{ external_request_id: string }];
  const bindingId = randomUUID();
  await f.source.query(
    `INSERT INTO operational_bindings(id,workspace_id,project_id,work_item_id,project_integration_binding_ref,connector_profile_ref,connection_header_id,connection_ref,mapping_ref,adapter_family,adapter_contract_version,external_entity_type,external_entity_id,initial_external_display_key,current_external_display_key,acceptance_source,sync_state,freshness_state,created_at,created_by,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'jira','1.0.0','REQUEST',$10,'DONE-1','DONE-1','VERIFIED_IMPORT','SYNCED','CURRENT',now(),$11,now())`,
    [
      bindingId,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      pins.bindingRef,
      pins.profileRef,
      pins.connectionRef.id,
      pins.connectionRef,
      pins.mappingRef,
      input.external_request_id,
      us3Actor.principalId,
    ],
  );
  const at = new Date().toISOString();
  await f.source.transaction(async (manager) => {
    await new TypeOrmOperationalAuthorityRepository(f.source).reduceObservation(
      manager,
      { ...f, bindingId },
      {
        observationId: randomUUID(),
        source: "IMPORT_READ",
        externalEntityId: input.external_request_id,
        externalDisplayKey: "DONE-1",
        externalRevisionToken: "provider-42",
        authorityFieldsHash: qaAggregateSnapshotHash({ status: "READY" } as never),
        providerUpdatedAt: at,
        observedAt: at,
        rawStatus: { id: "ready-1", name: "Ready" },
        normalizedStatus: "READY",
        requester: { externalPrincipalId: "requester", canonicalPrincipalId: us3Actor.principalId },
        profileRef: pins.profileRef,
        mappingRef: pins.mappingRef,
        connectionRef: pins.connectionRef,
        adapterFamily: "jira",
        adapterContractVersion: "1.0.0",
      },
      qaAggregateSnapshotHash("observation" as never),
      randomUUID(),
      randomUUID(),
    );
    await manager.query("UPDATE work_items SET operational_binding_id=$1 WHERE id=$2", [
      bindingId,
      f.workItemId,
    ]);
  });
  return bindingId;
}
