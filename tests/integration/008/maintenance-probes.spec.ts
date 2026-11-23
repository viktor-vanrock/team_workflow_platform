import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { qaValidationCapabilityRequirementSetV1 } from "../../../packages/competency-qa/src/node.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { createCapabilityProbeMaintenanceWorker } from "../../../packages/runtime-composition/src/pilot/maintenance-probes.ts";
import { qaLocalMigrations } from "../../../packages/runtime-composition/src/qa/composition.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 persisted capability probe maintenance",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "loads due work, records failures and rechecks pins on %s",
      async (image) => {
        const postgres = await startPostgres(image);
        const source = createPlatformDataSource({
          url: postgres.url,
          entities: [],
          migrations: [...qaLocalMigrations],
        });
        const workspaceId = randomUUID();
        const projectId = randomUUID();
        const profileId = randomUUID();
        const connectionId = randomUUID();
        const bindingId = randomUUID();
        const contextId = randomUUID();
        const digest = `sha256:${"a".repeat(64)}` as const;
        const reference = (id: string) => ({ id, version: 1, contentHash: digest });
        let now = new Date();
        let liveCalls = 0;
        let fail = false;
        let drift = false;
        try {
          await source.initialize();
          await source.runMigrations({ transaction: "all" });
          await source.query(
            "INSERT INTO workspaces(id,key,name,state) VALUES($1,'probe-workspace','Probe workspace','ACTIVE')",
            [workspaceId],
          );
          await source.query(
            "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'probe-project','Probe project','ACTIVE','INTERNAL')",
            [projectId, workspaceId],
          );
          await source.query(
            "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'jira',1)",
            [connectionId, workspaceId],
          );
          await source.query(
            "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED','{}',$4,now())",
            [randomUUID(), workspaceId, connectionId, digest],
          );
          await source.query(
            "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'jira',1)",
            [profileId, workspaceId],
          );
          await source.query(
            "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())",
            [
              randomUUID(),
              workspaceId,
              profileId,
              JSON.stringify({
                connectionRef: reference(connectionId),
                capabilityConfigurations: [
                  {
                    capabilityKey: "operational-work-item",
                    exactContractVersion: "1.0.0",
                    environmentScopes: ["LOCAL"],
                    operations: [
                      "request.create",
                      "request.transition",
                      "request.read",
                      "defect.create",
                    ].map((operation) => ({ operation })),
                  },
                ],
              }),
              digest,
            ],
          );
          await source.query(
            "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'current',1)",
            [bindingId, workspaceId, projectId],
          );
          const entries = ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT", "DEFECT_DESTINATION"].map(
            (logicalRole) => ({
              logicalRole,
              capabilityKey: "operational-work-item",
              exactContractVersion: "1.0.0",
              environmentScope: "LOCAL",
              profileRef: reference(profileId),
            }),
          );
          await source.query(
            "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,now())",
            [randomUUID(), workspaceId, projectId, bindingId, JSON.stringify({ entries }), digest],
          );
          const reportId = randomUUID();
          await source.query(
            "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,1,'VALID',$5,$6,now())",
            [
              reportId,
              workspaceId,
              projectId,
              bindingId,
              digest,
              JSON.stringify({ id: reportId, status: "VALID" }),
            ],
          );
          await source.query(
            "INSERT INTO qa_project_context_headers_v2(context_id,workspace_id,project_id,current_version,current_published_version) VALUES($1,$2,$3,1,1)",
            [contextId, workspaceId, projectId],
          );
          const requirement = {
            ...qaValidationCapabilityRequirementSetV1.ref,
            version: "1",
            kind: "CAPABILITY_REQUIREMENT_SET",
          };
          await source.query(
            "INSERT INTO qa_project_context_revisions_v2(revision_id,context_id,workspace_id,project_id,version,state,environment_refs,test_data_catalog_refs,account_pool_refs,policy_refs,maximum_classification_key,resource_version,published_at,created_by,published_by,semantic_body,content_hash) VALUES($1,$2,$3,$4,1,'PUBLISHED','[]','[]','[]',$5,'INTERNAL',1,now(),'{}','{}',$6,$7)",
            [
              randomUUID(),
              contextId,
              workspaceId,
              projectId,
              JSON.stringify({ capabilityRequirementSetRef: requirement }),
              JSON.stringify({ capabilityRequirementSetRef: requirement }),
              digest,
            ],
          );
          const options = {
            refreshAfterMs: 1000,
            validForMs: 2000,
            deadlineMs: 100,
            now: () => now.toISOString(),
            authorize: async () => true,
            observe: async () => {
              liveCalls++;
              if (drift) {
                drift = false;
                await source.query(
                  "UPDATE connector_profile_headers SET current_published_version=2 WHERE id=$1",
                  [profileId],
                );
              }
              if (fail) throw new Error("PROVIDER_SECRET_CANARY");
              return { status: "AVAILABLE" as const, safeIssueCodes: [] };
            },
          };
          const worker = createCapabilityProbeMaintenanceWorker(source, options);
          expect(await worker.run()).toMatchObject({ checked: 1, probes: 4 });
          expect(liveCalls).toBe(4);
          const [assessment] = (await source.query(
            "SELECT manual_requirements,automation_requirements FROM capability_mode_assessments",
          )) as readonly { manual_requirements: string; automation_requirements: string }[];
          expect(assessment).toEqual({
            manual_requirements: "SATISFIED",
            automation_requirements: "UNSATISFIED",
          });
          expect(await worker.run()).toMatchObject({ checked: 0 });
          now = new Date(now.getTime() + 1001);
          fail = true;
          expect(await worker.run()).toMatchObject({ checked: 1, probes: 4 });
          const failed = await source.query(
            "SELECT semantic_body FROM capability_probe_results WHERE status='UNAVAILABLE'",
          );
          expect(JSON.stringify(failed)).toContain("CAPABILITY_PROBE_FAILED");
          expect(JSON.stringify(failed)).not.toContain("PROVIDER_SECRET_CANARY");
          await source.destroy();
          await source.initialize();
          now = new Date(now.getTime() + 1001);
          fail = false;
          expect(
            await createCapabilityProbeMaintenanceWorker(source, {
              ...options,
              observe: undefined,
            }).run(),
          ).toMatchObject({ checked: 1, probes: 4 });
          now = new Date(now.getTime() + 1001);
          drift = true;
          expect(await worker.run()).toMatchObject({ checked: 0, stale: 1 });
          const counts = (await source.query(
            "SELECT count(*)::int AS count FROM capability_mode_assessments",
          )) as readonly { count: number }[];
          expect(counts[0]?.count).toBe(3);
          await expect(source.query("DELETE FROM capability_probe_results")).rejects.toThrow();
        } finally {
          if (source.isInitialized) await source.destroy();
          await postgres.stop();
        }
      },
      180_000,
    );
  },
);
