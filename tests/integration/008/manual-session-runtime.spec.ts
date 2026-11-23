import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authorizeQaApi } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  QaProjectPolicyRepository,
  QaRequestInputRepository,
  QaRequestRepository,
} from "../../../packages/competency-qa/src/node.ts";
import type { CompleteOperationalObservation } from "../../../packages/platform-core/src/index.ts";
import { TypeOrmOperationalAuthorityRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { PublishedQaSessionRuntime } from "../../../packages/runtime-composition/src/pilot/manual-session-runtime.ts";
import { PublishedQaReadinessFacts } from "../../../packages/runtime-composition/src/pilot/readiness-facts.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 exact manual session configuration",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "uses current scoped published references and denies drift/revocation on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        const ref = () => ({
          id: randomUUID(),
          version: 1,
          contentHash: `sha256:${"a".repeat(64)}` as const,
        });
        const pins = {
          workspaceId: f.workspaceId,
          projectId: f.projectId,
          bindingRef: ref(),
          profileRef: ref(),
          connectionRef: ref(),
        };
        const authority = {
          workspaceId: f.workspaceId,
          projectId: f.projectId,
          actor: us3Actor,
          authorize: (permission: "qa.session.plan" | "qa.session.execute" | "queue.work-admit") =>
            authorizeQaApi(f.source, f.request as never, f.workspaceId, f.projectId, permission),
        };
        try {
          await f.source.query(
            "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'session-config-proof',1)",
            [pins.connectionRef.id, f.workspaceId],
          );
          await f.source.query(
            "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED','{}',$4,now())",
            [randomUUID(), f.workspaceId, pins.connectionRef.id, pins.connectionRef.contentHash],
          );
          await f.source.query(
            "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'session-config-proof',1)",
            [pins.profileRef.id, f.workspaceId],
          );
          const capability = {
            capabilityKey: "operational-work-item",
            exactContractVersion: "1.0.0",
            environmentScopes: ["NON_PROD"],
            operations: [{ operation: "request.transition", effect: "WRITE" }],
          };
          await f.source.query(
            "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())",
            [
              randomUUID(),
              f.workspaceId,
              pins.profileRef.id,
              JSON.stringify({
                connectionRef: pins.connectionRef,
                capabilityConfigurations: [capability],
              }),
              pins.profileRef.contentHash,
            ],
          );
          await f.source.query(
            "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'session-config-proof',1)",
            [pins.bindingRef.id, f.workspaceId, f.projectId],
          );
          const entry = {
            logicalRole: "QA_REQUEST_AUTHORITY",
            capabilityKey: "operational-work-item",
            exactContractVersion: "1.0.0",
            environmentScope: "NON_PROD",
            profileRef: pins.profileRef,
            externalScope: { value: { environmentScope: "NON_PROD" } },
          };
          await f.source.query(
            "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,now())",
            [
              randomUUID(),
              f.workspaceId,
              f.projectId,
              pins.bindingRef.id,
              JSON.stringify({ entries: [entry] }),
              pins.bindingRef.contentHash,
            ],
          );
          const runtime = new PublishedQaSessionRuntime([pins], {
            assertEffectsAllowed: async () => {
              throw new Error("EFFECTS_UNAPPROVED");
            },
          });
          const expected = [{ id: pins.profileRef.id, version: 1 }];
          expect(
            await runtime.profiles(f.source, authority, pins.bindingRef, "qa.session.plan"),
          ).toEqual(expected);
          const storedExtension = (await new QaRequestRepository(f.source).byWorkItem(
            f,
            f.workItemId,
          ))!;
          const context = (await new QaProjectPolicyRepository(f.source).currentProjectContext(
            f,
            storedExtension.projectContextRef.id,
          ))!;
          const contextRef = {
            id: context.contextId,
            version: context.version,
            contentHash: context.contentHash,
          };
          const extension = {
            ...storedExtension,
            projectContextRef: contextRef,
            dorRuleSetRef: context.dorRuleSetRef,
          };
          const current = {
            ...(await new QaRequestInputRepository(f.source).get(f, f.workItemId, 1))!,
            operationalBindingRef: pins.bindingRef,
          };
          let clock = Math.floor(Date.now() / 1000) * 1000;
          const readinessPins = {
            ...pins,
            contextRef,
            freshnessPolicyRef: ref(),
            maximumProjectionAgeMs: 30_000,
            authorityScopeKey: "fixture.qa",
          };
          const readiness = new PublishedQaReadinessFacts(f.source, [readinessPins], () => clock);
          const facts = () =>
            f.source.transaction((manager) => readiness.load(manager, extension, current));
          expect((await facts()).acceptedRequest.exists).toBe(false);
          const bindingId = randomUUID();
          await f.source.query(
            `INSERT INTO operational_bindings(id,workspace_id,project_id,work_item_id,project_integration_binding_ref,connector_profile_ref,connection_header_id,connection_ref,mapping_ref,adapter_family,adapter_contract_version,external_entity_type,external_entity_id,initial_external_display_key,current_external_display_key,acceptance_source,sync_state,freshness_state,created_at,created_by,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'jira','1.0.0','REQUEST',$10,'FIXTURE-1','FIXTURE-1','VERIFIED_IMPORT','SYNCED','CURRENT',now(),$11,now())`,
            [
              bindingId,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              pins.bindingRef,
              pins.profileRef,
              pins.connectionRef.id,
              pins.connectionRef,
              ref(),
              current.externalRequestRef.id,
              us3Actor.principalId,
            ],
          );
          const snapshot: CompleteOperationalObservation = {
            observationId: randomUUID(),
            source: "IMPORT_READ",
            externalEntityId: current.externalRequestRef.id,
            externalDisplayKey: "FIXTURE-1",
            externalRevisionToken: "provider-v2",
            authorityFieldsHash: `sha256:${"b".repeat(64)}`,
            providerUpdatedAt: new Date(clock).toISOString(),
            observedAt: new Date(clock).toISOString(),
            rawStatus: { id: "1", name: "Open" },
            normalizedStatus: "NEW",
            requester: {
              externalPrincipalId: "fixture-requester",
              canonicalPrincipalId: current.originalRequesterRef.principalId,
            },
            profileRef: pins.profileRef,
            connectionRef: pins.connectionRef,
            mappingRef: ref(),
            adapterFamily: "jira",
            adapterContractVersion: "1.0.0",
          };
          await f.source.transaction(async (manager) => {
            await new TypeOrmOperationalAuthorityRepository(f.source).reduceObservation(
              manager,
              { ...pins, bindingId },
              snapshot,
              `sha256:${"c".repeat(64)}`,
              randomUUID(),
              randomUUID(),
            );
            await manager.query("UPDATE work_items SET operational_binding_id=$1 WHERE id=$2", [
              bindingId,
              f.workItemId,
            ]);
          });
          expect((await facts()).acceptedRequest).toEqual({
            exists: true,
            externalVersion: "provider-v2",
            normalizedStatus: "NEW",
          });
          clock += 30_000;
          expect((await facts()).acceptedRequest.exists).toBe(false);
          clock -= 30_000;
          await f.source.query(
            "UPDATE operational_bindings SET freshness_state='UNKNOWN' WHERE id=$1",
            [bindingId],
          );
          expect((await facts()).acceptedRequest.exists).toBe(false);
          await f.source.query(
            "UPDATE operational_bindings SET freshness_state='CURRENT' WHERE id=$1",
            [bindingId],
          );
          for (const entries of [
            [{ ...entry, environmentScope: "PRODUCTION" }],
            [entry, entry],
            [{ ...entry, capabilityKey: "other-capability" }],
          ]) {
            const bindingRef = ref();
            await f.source.query(
              "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,$4,1)",
              [bindingRef.id, f.workspaceId, f.projectId, `invalid-${bindingRef.id}`],
            );
            await f.source.query(
              "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,now())",
              [
                randomUUID(),
                f.workspaceId,
                f.projectId,
                bindingRef.id,
                JSON.stringify({ entries }),
                bindingRef.contentHash,
              ],
            );
            const invalid = new PublishedQaSessionRuntime([{ ...pins, bindingRef }], {
              assertEffectsAllowed: async () => {},
            });
            await expect(
              invalid.profiles(f.source, authority, bindingRef, "qa.session.plan"),
            ).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
          }
          for (const table of [
            "connection_headers",
            "connector_profile_headers",
            "project_integration_binding_headers",
          ] as const) {
            const id =
              table === "connection_headers"
                ? pins.connectionRef.id
                : table === "connector_profile_headers"
                  ? pins.profileRef.id
                  : pins.bindingRef.id;
            await f.source.query(`UPDATE ${table} SET current_published_version=2 WHERE id=$1`, [
              id,
            ]);
            await expect(
              runtime.profiles(f.source, authority, pins.bindingRef, "qa.session.execute"),
            ).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
            await expect(facts()).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
            await f.source.query(`UPDATE ${table} SET current_published_version=1 WHERE id=$1`, [
              id,
            ]);
          }
          await f.source.destroy();
          await f.source.initialize();
          expect(
            await runtime.profiles(f.source, authority, pins.bindingRef, "qa.session.execute"),
          ).toEqual(expected);
          expect((await facts()).acceptedRequest.exists).toBe(true);
          await expect(
            runtime.profiles(
              f.source,
              authority,
              { ...pins.bindingRef, version: 2 },
              "qa.session.plan",
            ),
          ).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=now() WHERE principal_id=$1 AND workspace_id=$2 AND project_id=$3",
            [us3Actor.principalId, f.workspaceId, f.projectId],
          );
          await expect(
            runtime.profiles(f.source, authority, pins.bindingRef, "qa.session.plan"),
          ).rejects.toThrow("QA_SESSION_CONFIGURATION_DENIED");
          expect((await facts()).requesterEntitlement.active).toBe(false);
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
