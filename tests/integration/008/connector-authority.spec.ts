import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import {
  type CorporateConnectorGrant,
  TypeOrmCorporateConnectorAuthority,
} from "../../../packages/runtime-composition/src/pilot/connector-authority.ts";
import type { CorporateConnectorBinding } from "../../../packages/runtime-composition/src/pilot/connector-factories.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 corporate connector Core authority",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "rechecks service rights and exact published chain on %s",
      async (image) => {
        const postgres = await startPostgres(image);
        const source = createPlatformDataSource({
          url: postgres.url,
          entities: [],
          migrations: migrationClasses(coreMigrationRegistry),
        });
        const workspaceId = randomUUID();
        const projectId = randomUUID();
        const principalId = randomUUID();
        const ref = (id = randomUUID()) => ({
          id,
          version: 1,
          contentHash: `sha256:${"a".repeat(64)}` as const,
        });
        const binding: CorporateConnectorBinding = {
          ref: ref(),
          workspaceId,
          projectId,
          servicePrincipalId: principalId,
          profileRef: ref(),
          connectionRef: ref(),
          policyRef: ref(),
          provider: "JIRA",
          mode: "LOCAL_FIXTURE",
          endpoint: "http://127.0.0.1:12345",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          routes: [
            {
              method: "GET",
              path: "/rest/api/3/issue/42",
              match: "EXACT",
              purpose: "CONNECTOR_READ",
            },
          ],
        };
        const integrationBindingRef = ref();
        const grant: CorporateConnectorGrant = {
          binding,
          integrationBindingRef,
          serviceIdentity: {
            issuer: "urn:corporate:workload",
            subject: "qa-worker",
            serviceKey: "worker.qa",
          },
          permissions: { CONNECTOR_READ: "qa.read", CONNECTOR_WRITE: "qa.write" },
        };
        try {
          await source.initialize();
          await source.runMigrations({ transaction: "all" });
          await source.query(
            "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'urn:corporate:workload','qa-worker','SERVICE','QA worker')",
            [principalId],
          );
          await source.query(
            "INSERT INTO workspaces(id,key,name,state) VALUES($1,'connector-authority','Authority','ACTIVE')",
            [workspaceId],
          );
          await source.query(
            "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'qa','QA','ACTIVE','INTERNAL')",
            [projectId, workspaceId],
          );
          await source.query(
            "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')",
            [randomUUID(), workspaceId, principalId],
          );
          await source.query(
            "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'WORKER','ALLOW','[\"qa.read\",\"qa.write\"]',now()-interval '1 day')",
            [randomUUID(), workspaceId, projectId, principalId],
          );
          await source.query(
            "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW','INTERNAL','[\"qa.read\",\"qa.write\"]',now()-interval '1 day')",
            [randomUUID(), workspaceId, projectId, principalId],
          );
          await source.query(
            "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'jira',1)",
            [binding.connectionRef.id, workspaceId],
          );
          await source.query(
            "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED','{}',$4,now())",
            [
              randomUUID(),
              workspaceId,
              binding.connectionRef.id,
              binding.connectionRef.contentHash,
            ],
          );
          await source.query(
            "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'jira',1)",
            [binding.profileRef.id, workspaceId],
          );
          await source.query(
            "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())",
            [
              randomUUID(),
              workspaceId,
              binding.profileRef.id,
              JSON.stringify({ connectionRef: binding.connectionRef }),
              binding.profileRef.contentHash,
            ],
          );
          await source.query(
            "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'jira',1)",
            [integrationBindingRef.id, workspaceId, projectId],
          );
          await source.query(
            "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,now())",
            [
              randomUUID(),
              workspaceId,
              projectId,
              integrationBindingRef.id,
              JSON.stringify({ entries: [{ profileRef: binding.profileRef }] }),
              integrationBindingRef.contentHash,
            ],
          );
          let authority = new TypeOrmCorporateConnectorAuthority(source, [grant]);
          const signal = new AbortController().signal;
          expect(await authority.authorize(binding, "CONNECTOR_READ", signal)).toBe(true);
          expect(await authority.authorize(binding, "CONNECTOR_WRITE", signal)).toBe(false); // No durable command admission.
          expect(
            await authority.authorize(
              { ...binding, projectId: randomUUID() },
              "CONNECTOR_READ",
              signal,
            ),
          ).toBe(false);
          expect(
            await authority.authorize(
              { ...binding, profileRef: { ...binding.profileRef, version: 2 } },
              "CONNECTOR_READ",
              signal,
            ),
          ).toBe(false);
          expect(await authority.authorize(binding, "CONNECTOR_READ", AbortSignal.abort())).toBe(
            false,
          );
          await source.query(
            "UPDATE project_entitlements SET revoked_at=now() WHERE principal_id=$1",
            [principalId],
          );
          expect(await authority.authorize(binding, "CONNECTOR_READ", signal)).toBe(false);
          await source.query(
            "UPDATE project_entitlements SET revoked_at=NULL WHERE principal_id=$1",
            [principalId],
          );
          await source.query(
            "UPDATE connector_profile_headers SET current_published_version=2 WHERE id=$1",
            [binding.profileRef.id],
          );
          expect(await authority.authorize(binding, "CONNECTOR_READ", signal)).toBe(false);
          await source.query(
            "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
            [binding.profileRef.id],
          );
          await source.query("UPDATE role_assignments SET effect='DENY' WHERE principal_id=$1", [
            principalId,
          ]);
          expect(await authority.authorize(binding, "CONNECTOR_READ", signal)).toBe(false);
          await source.query("UPDATE role_assignments SET effect='ALLOW' WHERE principal_id=$1", [
            principalId,
          ]);
          await source.destroy();
          await source.initialize();
          authority = new TypeOrmCorporateConnectorAuthority(source, [grant]);
          expect(await authority.authorize(binding, "CONNECTOR_READ", signal)).toBe(true);
          await source.query("UPDATE identities SET kind='HUMAN' WHERE id=$1", [principalId]);
          expect(await authority.authorize(binding, "CONNECTOR_READ", signal)).toBe(false);
        } finally {
          if (source.isInitialized) await source.destroy();
          await postgres.stop();
        }
      },
      180_000,
    );
  },
);
