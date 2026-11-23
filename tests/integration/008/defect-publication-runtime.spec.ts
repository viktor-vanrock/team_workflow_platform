import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizeQaApi } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { QaDefectsController } from "../../../apps/api/src/extensions/qa-defects.controller.ts";
import { qaAggregateSnapshotHash, type QaScope } from "../../../packages/competency-qa/src/node.ts";
import { externalCommandLifecycleContext } from "../../../packages/platform-core/src/index.ts";
import { TypeOrmCommandRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { DurableQaDefectApprovalRuntime } from "../../../packages/runtime-composition/src/pilot/defect-approval-runtime.ts";
import { currentQaDefectCommandAuthority } from "../../../packages/runtime-composition/src/pilot/defect-command-authority.ts";
import {
  PublishedQaDefectPublicationConfiguration,
  type QaDefectPublicationPins,
} from "../../../packages/runtime-composition/src/pilot/defect-publication-configuration.ts";
import {
  DurableQaDefectPublicationRuntime,
  type QaDefectPublicationAuthority,
} from "../../../packages/runtime-composition/src/pilot/defect-publication-runtime.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";
import { create008FrozenProductFinding } from "../../support/008-frozen-finding.ts";
import { localQaTestRequest } from "../../support/008-qa-request.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

async function seedConfiguration(
  source: Us3DatabaseFixture["source"],
  scope: QaScope,
  variant: "valid" | "production" | "duplicate" | "target" | "classification" = "valid",
): Promise<QaDefectPublicationPins> {
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
    await source.query(
      `INSERT INTO ${table}_headers(id,workspace_id,key,current_published_version${binding ? ",project_id" : ""}) VALUES($1,$2,$3,1${binding ? ",$4" : ""})`,
      [ref.id, scope.workspaceId, `defect-${ref.id}`, ...(binding ? [scope.projectId] : [])],
    );
    await source.query(
      `INSERT INTO ${table}_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at${binding ? ",project_id" : ""}) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now()${binding ? ",$6" : ""})`,
      [
        randomUUID(),
        scope.workspaceId,
        ref.id,
        content,
        ref.contentHash,
        ...(binding ? [scope.projectId] : []),
      ],
    );
    return ref;
  };
  const connectorKey = "jira.operational-authority";
  const authorityScopeKey = `proof.${randomUUID()}`;
  const chain = async (operation: string) => {
    const connectionRef = await insert("connection", {
      connectorKey,
      projectId: "RANDOM-PROJECT",
      issueTypeId: "DEFECT-TYPE",
    });
    const mappingRef = await insert("connector_mapping", { connectorKey, authorityScopeKey });
    const profileRef = await insert("connector_profile", {
      connectorKey,
      connectionRef,
      mappingRef,
      capabilityConfigurations: [
        {
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          environmentScopes: ["NON_PROD"],
          allowedDataClassifications:
            variant === "classification" ? ["PUBLIC"] : ["PUBLIC", "INTERNAL"],
          operations: [{ operation, effect: "WRITE" }],
        },
      ],
    });
    return { connectionRef, mappingRef, profileRef };
  };
  const destination = await chain("defect.create");
  const requestAuthority = await chain("request.transition");
  const entries = [
    ["DEFECT_DESTINATION", destination, "DEFECT"],
    ["QA_REQUEST_AUTHORITY", requestAuthority, "REQUEST"],
  ].map(([role, pins, kind]) => ({
    logicalRole: role,
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    environmentScope: variant === "production" ? "PRODUCTION" : "NON_PROD",
    classificationCeilingKey: "INTERNAL",
    profileRef: (pins as typeof destination).profileRef,
    externalScope: {
      value: { authorityScopeKey, environmentScope: "NON_PROD", allowedEntityKinds: [kind] },
    },
  }));
  const bindingRef = await insert("project_integration_binding", {
    entries: variant === "duplicate" ? [...entries, entries[0]] : entries,
  });
  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    bindingRef,
    destination,
    requestAuthority,
    authorityScopeKey,
    externalProjectId: variant === "target" ? "OTHER-PROJECT" : "RANDOM-PROJECT",
    externalIssueTypeId: "DEFECT-TYPE",
    maximumClassificationKey: "INTERNAL",
  };
}

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 durable defect publication",
  () => {
    afterEach(() => vi.useRealTimers());
    it.each(POSTGRES_TEST_IMAGES)(
      "atomically publishes exact inputs, replays after restart and rejects current drift on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        try {
          const pins = await seedConfiguration(f.source, f);
          const configuration = new PublishedQaDefectPublicationConfiguration([pins]);
          const runtime = new DurableQaDefectPublicationRuntime(f.source, configuration);
          const controller = new QaDefectsController(
            f.source,
            runtime,
            new DurableQaDefectApprovalRuntime(f.source, runtime),
          );
          const finding = await create008FrozenProductFinding(f);
          const draft = await controller.create(
            f.request as never,
            f.workspaceId,
            f.projectId,
            f.workItemId,
            finding.findingId,
            `W/"${finding.resourceVersion}"`,
            { source: "DETERMINISTIC_TEMPLATE" },
            f.response,
          );
          const authority: QaDefectPublicationAuthority = {
            workspaceId: f.workspaceId,
            projectId: f.projectId,
            authorize: (permission) =>
              authorizeQaApi(f.source, f.request as never, f.workspaceId, f.projectId, permission),
          };
          const publish = (r = runtime, a = authority) =>
            r.publish(a, f.workItemId, draft.defectDraftId, 1);
          await expect(
            runtime.publish(
              { ...authority, projectId: randomUUID() },
              f.workItemId,
              draft.defectDraftId,
              1,
            ),
          ).rejects.toThrow();
          await expect(
            runtime.publish(authority, randomUUID(), draft.defectDraftId, 1),
          ).rejects.toThrow("NOT_FOUND");
          await expect(
            runtime.publish(authority, f.workItemId, draft.defectDraftId, 2),
          ).rejects.toThrow("STALE");
          for (const variant of ["production", "duplicate", "target", "classification"] as const) {
            const invalid = new DurableQaDefectPublicationRuntime(
              f.source,
              new PublishedQaDefectPublicationConfiguration([
                await seedConfiguration(f.source, f, variant),
              ]),
            );
            await expect(publish(invalid)).rejects.toThrow(
              variant === "classification" ? "CLASSIFICATION_DENIED" : "CONFIGURATION_DENIED",
            );
          }
          const head = async (version: number) =>
            f.source.query(
              "UPDATE connector_profile_headers SET current_published_version=$1 WHERE id=$2",
              [version, pins.destination.profileRef.id],
            );
          await head(2);
          await expect(publish()).rejects.toThrow("CONFIGURATION_DENIED");
          await head(1);
          await f.source.query(
            `CREATE FUNCTION reject_defect_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_DEFECT_OUTBOX_FAILURE'; END $$`,
          );
          await f.source.query(
            "CREATE TRIGGER reject_defect_outbox BEFORE INSERT ON command_outbox FOR EACH ROW EXECUTE FUNCTION reject_defect_outbox()",
          );
          await expect(publish()).rejects.toThrow("FORCED_DEFECT_OUTBOX_FAILURE");
          expect(
            await f.source.query(
              "SELECT state,resource_version,command_ref,accepted_by FROM qa_defect_drafts WHERE defect_draft_id=$1",
              [draft.defectDraftId],
            ),
          ).toEqual([
            { state: "DRAFT", resource_version: "1", command_ref: null, accepted_by: null },
          ]);
          expect(
            await f.source.query(
              "SELECT id FROM connector_commands WHERE payload->'metadata'->>'commandType'='qa.defect.create'",
            ),
          ).toHaveLength(0);
          expect(
            await f.source.query("SELECT id FROM approvals WHERE initiator_id=$1", [
              us3Actor.principalId,
            ]),
          ).toHaveLength(0);
          await f.source.query("DROP TRIGGER reject_defect_outbox ON command_outbox");
          const lead = await localQaTestRequest(f.source, "lead.alpha");
          const leadActor = (
            await authorizeQaApi(f.source, lead, f.workspaceId, f.projectId, "qa.defect.publish")
          ).actor;
          const leadAuthority = currentQaDefectCommandAuthority(f.source, f, leadActor, "INTERNAL");
          await expect(publish(runtime, leadAuthority)).rejects.toThrow("AUTHORITY_DENIED");
          for (const actor of [us3Actor, leadActor]) {
            for (const table of ["role_assignments", "project_entitlements"])
              await f.source.query(
                `UPDATE ${table} SET permissions=permissions || '["command.execute","integration.use","approval.decide","connector.effect.approve"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
                [f.workspaceId, f.projectId, actor.principalId],
              );
          }
          const published = await Promise.all([
            publish(),
            publish(),
            publish(runtime, leadAuthority),
          ]);
          expect(new Set(published.map((p) => p.operationId)).size).toBe(1);
          expect(published.filter((p) => !p.replayed)).toHaveLength(1);
          expect(published[0]).toMatchObject({ state: "AWAITING_APPROVAL", resourceVersion: 3 });
          const command = (await new TypeOrmCommandRepository(f.source).get(
            f.workspaceId,
            f.projectId,
            published[0]!.operationId,
          ))!;
          expect(command).toMatchObject({
            recoveryPolicy: "LOOKUP_REQUIRED",
            outboxStatus: "HELD",
            payload: {
              sourceRefs: expect.arrayContaining([
                expect.objectContaining({
                  id: finding.frozenFindingReviewRef.id,
                  version: String(finding.frozenFindingReviewRef.version),
                  contentHash: finding.frozenFindingReviewRef.contentHash,
                }),
              ]),
            },
          });
          expect(command.target).toMatchObject({
            authorityScopeKey: pins.authorityScopeKey,
            externalProjectId: pins.externalProjectId,
          });
          expect(
            await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
              command.id,
            ]),
          ).toEqual([{ state: "HELD" }]);
          await f.source.destroy();
          await f.source.initialize();
          const restarted = new DurableQaDefectPublicationRuntime(
            f.source,
            new PublishedQaDefectPublicationConfiguration([pins]),
          );
          expect(await publish(restarted)).toMatchObject({
            operationId: command.id,
            approvalId: command.approvalId,
            replayed: true,
          });
          const contribution = restarted.lifecycleContribution(() =>
            command.actor.principalId === us3Actor.principalId ? authority : leadAuthority,
          );
          const context = externalCommandLifecycleContext(command);
          const release = () =>
            f.source.transaction((manager) =>
              contribution.apply("APPROVAL_RELEASED", context, {
                native: manager,
                phase: "APPROVAL_RELEASED",
                transactionId: randomUUID(),
                contributionKey: contribution.key,
                idempotencyKey: `${command.id}:APPROVAL_RELEASED:${contribution.key}`,
              }),
            );
          expect(await release()).toMatchObject({
            idempotencyKey: `${command.id}:APPROVAL_RELEASED:${contribution.key}`,
          });
          for (const [table, id] of [
            ["connector_profile_headers", pins.destination.profileRef.id],
            ["connector_mapping_headers", pins.destination.mappingRef.id],
            ["connection_headers", pins.destination.connectionRef.id],
            ["connector_profile_headers", pins.requestAuthority.profileRef.id],
            ["project_integration_binding_headers", pins.bindingRef.id],
          ]) {
            await f.source.query(`UPDATE ${table} SET current_published_version=2 WHERE id=$1`, [
              id,
            ]);
            await expect(release()).rejects.toThrow("CONFIGURATION_DENIED");
            await expect(publish(restarted)).rejects.toThrow("CONFIGURATION_DENIED");
            await f.source.query(`UPDATE ${table} SET current_published_version=1 WHERE id=$1`, [
              id,
            ]);
          }
          await f.source.query(
            "UPDATE work_items SET classification_key='CONFIDENTIAL' WHERE id=$1",
            [f.workItemId],
          );
          await expect(publish(restarted)).rejects.toThrow("CLASSIFICATION_DENIED");
          await expect(release()).rejects.toThrow("CLASSIFICATION_DENIED");
          await f.source.query("UPDATE work_items SET classification_key='INTERNAL' WHERE id=$1", [
            f.workItemId,
          ]);
          const approvalRuntime = new DurableQaDefectApprovalRuntime(f.source, restarted);
          const initiator = currentQaDefectCommandAuthority(
            f.source,
            f,
            command.actor as typeof us3Actor,
            "INTERNAL",
          );
          const approver = currentQaDefectCommandAuthority(
            f.source,
            f,
            command.actor.principalId === us3Actor.principalId ? leadActor : us3Actor,
            "INTERNAL",
          );
          const approve = () =>
            approvalRuntime.approve(approver, f.workItemId, command.approvalId!);
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(new Date(command.createdAt.getTime() + 15 * 60_000));
          await expect(approve()).rejects.toThrow("APPROVAL_DENIED");
          vi.useRealTimers();
          await expect(
            approvalRuntime.approve(initiator, f.workItemId, command.approvalId!),
          ).rejects.toThrow("APPROVAL_DENIED");
          await expect(
            approvalRuntime.approve(approver, randomUUID(), command.approvalId!),
          ).rejects.toThrow("APPROVAL_DENIED");
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=now() WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, command.actor.principalId],
          );
          await expect(release()).rejects.toThrow();
          await expect(approve()).rejects.toThrow();
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, command.actor.principalId],
          );
          await head(2);
          await expect(approve()).rejects.toThrow("CONFIGURATION_DENIED");
          await head(1);
          await f.source.query(
            `CREATE FUNCTION reject_defect_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='READY' THEN RAISE EXCEPTION 'FORCED_RELEASE_FAILURE'; END IF; RETURN NEW; END $$`,
          );
          await f.source.query(
            "CREATE TRIGGER reject_defect_release BEFORE UPDATE ON command_outbox FOR EACH ROW EXECUTE FUNCTION reject_defect_release()",
          );
          await expect(approve()).rejects.toThrow("FORCED_RELEASE_FAILURE");
          expect(
            (await new TypeOrmCommandRepository(f.source).get(
              f.workspaceId,
              f.projectId,
              command.id,
            ))!.status,
          ).toBe("AWAITING_APPROVAL");
          expect(
            await f.source.query("SELECT decision_state FROM approvals WHERE id=$1", [
              command.approvalId,
            ]),
          ).toEqual([{ decision_state: "PENDING" }]);
          await f.source.query("DROP TRIGGER reject_defect_release ON command_outbox");
          const decisions = await Promise.allSettled([approve(), approve()]);
          expect(decisions.filter((d) => d.status === "fulfilled")).toHaveLength(1);
          expect(decisions.filter((d) => d.status === "rejected")).toHaveLength(1);
          expect(
            await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
              command.id,
            ]),
          ).toEqual([{ state: "READY" }]);
          expect(
            await f.source.query("SELECT state FROM qa_defect_drafts WHERE defect_draft_id=$1", [
              draft.defectDraftId,
            ]),
          ).toEqual([{ state: "AUTHORIZED" }]);
          expect(
            (await new TypeOrmCommandRepository(f.source).get(
              f.workspaceId,
              f.projectId,
              command.id,
            ))!,
          ).toMatchObject({
            status: "QUEUED",
            effectAuthorizationStatus: "CONSUMED",
            attemptCount: 0,
          });
          expect(
            await f.source.query(
              "SELECT action FROM audit_events WHERE action='qa.defect.approve'",
            ),
          ).toHaveLength(1);
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
