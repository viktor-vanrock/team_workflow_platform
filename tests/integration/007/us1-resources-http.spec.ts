import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { digest, ref } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 resource publication HTTP",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "publishes immutable environments, data, pools and context with scoped lease capacity on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          const policy = ref("controlled-policy", 1, digest({ policy: "local" }));
          const configuration = {
            key: "local-environment",
            schemaRef: { id: "controlled-schema", version: 1, digest: digest({ type: "object" }) },
            resourceRef: ref("local-runtime", 1, digest({ local: true })),
          };
          const body = {
            environmentId: randomUUID(),
            key: "local-http",
            name: "Local HTTP",
            scope: "LOCAL",
            ownerPrincipalId: localPersonaIds["lead.alpha"],
            dataClassificationKey: "INTERNAL",
            configurationRef: configuration,
            allowedTestDataPolicyRefs: [policy],
            reason: "Local HTTP publication",
          };
          const published = await f.send("qa/environments", body, "publish-http-environment", 1);
          expect(published, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { resultRef: { id: body.environmentId, version: 1 } },
          });
          const environmentRef = published.body.resultRef;
          const revised = await f.send(
            "qa/environments",
            { ...body, name: "Local HTTP revision" },
            "revise-http-environment",
            1,
          );
          expect(revised).toMatchObject({ status: 201, body: { resultRef: { version: 2 } } });
          expect((await f.send("qa/environments", body, "stale-http-environment", 1)).status).toBe(
            409,
          );
          const env = revised.body.resultRef;
          const dataset = {
            kind: "DATASET",
            resourceId: randomUUID(),
            externalRef: ref("dataset", 1, digest({ data: "local" })),
            ownerPrincipalId: body.ownerPrincipalId,
            allowedEnvironmentRefs: [env],
            dataClassificationKey: "INTERNAL",
            retentionPolicyRef: policy,
          };
          expect(
            (
              await f.send(
                "qa/resources/test-data",
                { ...dataset, allowedEnvironmentRefs: [{ ...env, id: randomUUID() }] },
                "foreign-http-environment",
                1,
              )
            ).status,
          ).toBe(409);
          const data = await f.send("qa/resources/test-data", dataset, "publish-http-data", 1);
          expect(data).toMatchObject({ status: 201 });
          const inventory = {
            id: "local-http-accounts",
            version: 1,
            ...f.scope,
            opaqueAccountRefs: ["accountref://controlled/account-1"],
          };
          const pool = await f.send(
            "qa/resources/account-pools",
            {
              kind: "ACCOUNT_POOL",
              resourceId: randomUUID(),
              environmentRef: env,
              resolverRef: {
                ...configuration,
                key: "file-account-inventory",
                resourceRef: ref(inventory.id, 1, digest(inventory)),
              },
              ownerPrincipalId: body.ownerPrincipalId,
              maximumConcurrentLeases: 1,
              maximumLeaseDurationSeconds: 300,
              dataClassificationKey: "INTERNAL",
            },
            "publish-http-pool",
            1,
          );
          expect(pool).toMatchObject({ status: 201 });
          const context = {
            environmentRefs: [env],
            testDataCatalogRefs: [data.body.resultRef],
            accountPoolRefs: [pool.body.resultRef],
            targetPolicyRefs: [policy],
            scopePolicyRefs: [policy],
            checklistPolicyRefs: [policy],
            defaultTargetPolicyRef: policy,
            defaultScopePolicyRef: policy,
            defaultChecklistRefs: [policy],
            evidencePolicyRef: policy,
            retentionPolicyRef: policy,
            redactionPolicyRef: policy,
            exportPolicyRef: policy,
            riskReviewPolicyRef: policy,
            dorRuleSetRef: policy,
            dodRuleSetRef: policy,
            capabilityRequirementSetRef: policy,
            maximumClassificationKey: "INTERNAL",
            reason: "Publish local context",
          };
          const contextResult = await f.send("qa/context", context, "publish-http-context", 1);
          expect(contextResult, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { resultRef: { version: 2 } },
          });
          const [item] = (await f.source.query(
            "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 LIMIT 1",
            [f.scope.workspaceId, f.scope.projectId],
          )) as { id: string }[];
          const environmentRows = (await f.source.query(
            "SELECT semantic_body FROM qa_project_environment_revisions WHERE environment_id=$1",
            [body.environmentId],
          )) as { semantic_body: unknown }[];
          for (const row of environmentRows)
            expect(() =>
              designContractRegistry.validateById(
                "urn:awp:schemas:007:project-environment-revision:v1",
                row.semantic_body,
              ),
            ).not.toThrow();
          const [contextRow] = (await f.source.query(
            "SELECT semantic_body FROM qa_project_context_revisions_v2 WHERE context_id=$1 AND version=2",
            [f.contextId],
          )) as { semantic_body: unknown }[];
          expect(() =>
            designContractRegistry.validateById(
              "urn:awp:schemas:007:qa-project-context:v2",
              contextRow!.semantic_body,
            ),
          ).not.toThrow();
          expect(
            (
              await f.send(
                "qa/context",
                { ...context, maximumClassificationKey: "PUBLIC" },
                "insufficient-context-classification",
                2,
              )
            ).status,
          ).toBe(409);
          const lease = {
            environmentRef: env,
            accountPoolRef: pool.body.resultRef,
            subjectRef: `work-item:${item!.id}`,
            purpose: "Local account test",
            requestedUntil: new Date(Date.now() + 120_000).toISOString(),
          };
          await f.source.query(
            "CREATE FUNCTION fail_lease_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='QA_ACCOUNT_LEASE_ACQUIRED' THEN RAISE EXCEPTION 'controlled lease audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_lease_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_lease_audit()",
          );
          expect(
            (await f.send("qa/account-leases", lease, "atomic-lease-rollback", 1, "executor"))
              .status,
          ).toBe(503);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM qa_test_account_lease_heads WHERE pool_id=$1",
              [pool.body.resultRef.id],
            ),
          ).toEqual([{ n: 0 }]);
          expect(
            await f.source.query(
              "SELECT result_ref FROM client_request_idempotency WHERE client_key='atomic-lease-rollback'",
            ),
          ).toHaveLength(0);
          await f.source.query("DROP TRIGGER fail_lease_audit ON audit_events");
          const acquired = await f.send(
            "qa/account-leases",
            lease,
            "acquire-http-account",
            1,
            "executor",
          );
          expect(acquired, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { leaseId: expect.any(String), version: 1 },
          });
          const leaseId = acquired.body.leaseId as string;
          expect(
            (await f.send("qa/account-leases", lease, "exhausted-http-account", 1, "executor"))
              .status,
          ).toBe(409);
          await f.restart();
          expect(
            await f.send("qa/account-leases", lease, "acquire-http-account", 1, "executor"),
          ).toEqual(acquired);
          expect(
            (
              await f.send(
                `qa/account-leases/${leaseId}/release`,
                { reason: "Wrong actor" },
                "wrong-account-release",
                1,
                "admin",
              )
            ).status,
          ).toBe(403);
          expect(
            (
              await f.send(
                `qa/account-leases/${leaseId}/release`,
                { reason: "Stale version" },
                "stale-account-release",
                2,
                "executor",
              )
            ).status,
          ).toBe(409);
          expect(
            (
              await f.send(
                `qa/account-leases/${leaseId}/release`,
                { reason: "Completed local test" },
                "release-http-account",
                1,
                "executor",
              )
            ).status,
          ).toBe(201);
          expect(
            (await f.send("qa/account-leases", lease, "reacquire-http-account", 1, "executor"))
              .status,
          ).toBe(201);
          expect(
            await f.source.query(
              "SELECT version FROM qa_project_environment_revisions WHERE environment_id=$1 ORDER BY version",
              [body.environmentId],
            ),
          ).toEqual([{ version: 1 }, { version: 2 }]);
          expect(
            await f.source.query(
              "SELECT content_hash FROM qa_project_environment_revisions WHERE environment_id=$1 AND version=1",
              [body.environmentId],
            ),
          ).toEqual([{ content_hash: environmentRef.contentHash }]);
          const leaseRows = (await f.source.query(
            "SELECT semantic_body FROM qa_test_account_leases WHERE pool_id=$1",
            [pool.body.resultRef.id],
          )) as { semantic_body: unknown }[];
          for (const row of leaseRows)
            expect(() =>
              designContractRegistry.validateById(
                "urn:awp:schemas:007:test-account-lease:v1",
                row.semantic_body,
              ),
            ).not.toThrow();
          expect(JSON.stringify(acquired.body)).not.toMatch(/password|credential|secretValue/iu);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
  },
);
