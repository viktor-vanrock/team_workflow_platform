import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { digest, ref } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { qaValidationCapabilityRequirementSetV1 } from "../../../packages/competency-qa/src/node.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import type { ExactRevisionRef } from "../../../packages/platform-core/src/index.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { localPersonaCatalog } from "../../../packages/runtime-composition/src/security/local-security.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaLocalSeed } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { prepareJourneyBinding } from "../../support/007-manual-binding.ts";
import { prepareManualRequest } from "../../support/007-manual-request.ts";
import { startOnboardingProcess } from "../../support/007-onboarding-child.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 independent manual onboarding HTTP/PostgreSQL/worker journey",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "registers through manual Session start and denies automation before persistence on %s",
      async (image) => {
        Object.assign(process.env, {
          AWP_RUNTIME_PROFILE: "test",
          AWP_COMPOSITION: "qa-local",
          AWP_EXTERNAL_NETWORK_MODE: "deny",
          AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
          AWP_MOCK_HUB_URL: "http://127.0.0.1:1",
          AWP_QUEUE_STATIC_CONTOUR: "false",
        });
        const postgres = await startPostgres(image),
          source = createPlatformDataSource({
            url: postgres.url,
            entities: qaLocalEntities,
            migrations: qaLocalMigrations,
          });
        const providerCalls: string[] = [];
        const provider = createServer((request, response) => {
          providerCalls.push(
            `${request.method} ${new URL(request.url!, "http://localhost").searchParams.get("operation")}`,
          );
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ status: "AVAILABLE", safeIssueCodes: [] }));
        });
        let api: Awaited<ReturnType<typeof startOnboardingProcess>> | undefined, worker: typeof api;
        try {
          await source.initialize();
          await source.runMigrations({ transaction: "all" });
          await runQaLocalSeed(source);
          // IAM roles are prerequisite input; project entitlements are granted only through HTTP.
          await new Promise<void>((resolve) => {
            provider.listen(0, "127.0.0.1", resolve);
          });
          const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
          api = await startOnboardingProcess(postgres.url, providerUrl, "api");
          worker = await startOnboardingProcess(postgres.url, providerUrl, "worker");
          expect(new Set([process.pid, api.pid, worker.pid]).size).toBe(3);
          const base = `/api/v1/workspaces/${localSeedIds.workspaceFunctional}/projects`;
          const request = async (
            path: string,
            body?: unknown,
            token = "admin",
            match?: string,
            key: string = randomUUID(),
          ) => {
            const response = await fetch(api!.origin + path, {
              method: body === undefined ? "GET" : "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "idempotency-key": key,
                ...(match ? { "if-match": match } : {}),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            return {
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: (await response.json()) as Record<string, unknown>,
            };
          };
          const ok = async (...args: Parameters<typeof request>) => {
            const r = await request(...args);
            expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
            return r;
          };
          const owners = Object.fromEntries(
            ["business", "technical", "qa", "security", "escalation"].map((k) => [
              k,
              localPersonaIds["owner.local"],
            ]),
          );
          const registration = {
            key: "JOURNEY",
            name: "Manual onboarding journey",
            ownerIds: owners,
            criticalityKey: "STANDARD",
            dataClassificationKey: "INTERNAL",
            reason: "Independent HTTP onboarding",
          };
          const registered = await ok(base, registration, "owner", undefined, "journey-register"),
            projectId = String(registered.body.projectId),
            scope = { workspaceId: localSeedIds.workspaceFunctional, projectId },
            project = `${base}/${projectId}`;
          expect(registered.body).toMatchObject({
            stage: "DRAFT",
            qaCapabilityMode: "MANUAL_ONLY",
          });
          const current = () => ok(`${project}/onboarding`, undefined, "owner");
          for (const persona of [
            "owner.local",
            "integration-admin.alpha",
            "lead.alpha",
            "executor.alpha",
          ] as const) {
            const permissions = localPersonaCatalog
              .resolve(persona)
              .permissions.filter((p) => p !== "*");
            await source.query(
              "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,$5,'ALLOW',$6,now())",
              [
                randomUUID(),
                scope.workspaceId,
                projectId,
                localPersonaIds[persona],
                localPersonaCatalog.resolve(persona).roles[0],
                JSON.stringify(permissions),
              ],
            );
            await ok(
              `${project}/entitlements`,
              {
                principalId: localPersonaIds[persona],
                operation: "GRANT",
                effect: "ALLOW",
                permissions,
                classificationCeilingKey: "INTERNAL",
                validFrom: new Date(Date.now() - 1000).toISOString(),
                reason: "Grant scoped journey access",
              },
              "owner",
              (await current()).headers.etag,
            );
          }
          const policy = ref("journey-policy", 1, digest({ policy: "manual" })),
            ownerPrincipalId = localPersonaIds["lead.alpha"];
          const envBody = {
            environmentId: randomUUID(),
            key: "manual-local",
            name: "Manual local",
            scope: "LOCAL",
            ownerPrincipalId,
            dataClassificationKey: "INTERNAL",
            configurationRef: {
              key: "local-environment",
              schemaRef: {
                id: "urn:controlled:environment",
                version: 1,
                digest: digest({ type: "object" }),
              },
              resourceRef: ref("local-env-config", 1, digest({ scope: "LOCAL" })),
            },
            allowedTestDataPolicyRefs: [policy],
            reason: "Publish environment",
          };
          const pin = (r: Awaited<ReturnType<typeof ok>>) =>
            JSON.parse(r.headers["awp-resource-ref"]!) as ExactRevisionRef;
          const environmentRef = pin(await ok(`${project}/qa/environments`, envBody));
          const data = await ok(`${project}/qa/resources/test-data`, {
              kind: "DATASET",
              resourceId: randomUUID(),
              externalRef: ref("opaque-data", 1, digest({ fixture: true })),
              ownerPrincipalId,
              allowedEnvironmentRefs: [environmentRef],
              dataClassificationKey: "INTERNAL",
              retentionPolicyRef: policy,
            }),
            dataRef = data.body.resultRef as ExactRevisionRef;
          const pool = await ok(`${project}/qa/resources/account-pools`, {
            kind: "ACCOUNT_POOL",
            resourceId: randomUUID(),
            environmentRef,
            resolverRef: { ...envBody.configurationRef, key: "controlled-inventory" },
            ownerPrincipalId,
            maximumConcurrentLeases: 1,
            maximumLeaseDurationSeconds: 300,
            dataClassificationKey: "INTERNAL",
          });
          const contextBody = {
            environmentRefs: [environmentRef],
            testDataCatalogRefs: [dataRef],
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
            reason: "Publish exact manual context",
          };
          const contextRef = pin(await ok(`${project}/qa/context`, contextBody)),
            bindingRef = await prepareJourneyBinding(source, scope, providerUrl);
          const validated = await ok(
            `${project}/bindings/${bindingRef.id}/validate`,
            {
              bindingVersion: 1,
              bindingContentHash: bindingRef.contentHash,
              probeKeys: qaValidationCapabilityRequirementSetV1.requirements
                .filter((r) => r.mode === "MANUAL")
                .map((r) => r.requirementKey),
            },
            "admin",
            '"1"',
          );
          expect(validated.body.state).toBe("ACCEPTED");
          await worker.close();
          worker = await startOnboardingProcess(postgres.url, providerUrl, "worker");
          expect(await worker.send("run")).toEqual({ completed: 1, rejected: 0, probes: 4 });
          expect(providerCalls).toHaveLength(4);
          expect(providerCalls.every((call) => call.startsWith("GET "))).toBe(true);
          await ok(
            `${project}/bindings/${bindingRef.id}/acceptances`,
            {
              bindingRef,
              validationReportRef: validated.body.resultRef,
              qaProjectContextRef: contextRef,
              acceptedResourceRefs: [environmentRef, dataRef],
              checklistRef: policy,
              outcome: "ACCEPTED",
              reason: "QA accepts manual environment and data",
            },
            "lead",
          );
          const legacy = project.replace("/api/v1/", "/v1/");
          const candidate = await ok(
            `${legacy}/binding-candidates`,
            { operation: "publish", bindingRef, reason: "Publish accepted manual binding" },
            "admin",
            (await current()).headers.etag,
          );
          const approval = await ok(
            `${legacy}/operations/approvals`,
            { candidateRef: candidate.body.resultRef },
            "owner",
            (await current()).headers.etag,
          );
          await ok(
            `${project}/bindings/${bindingRef.id}/publish`,
            { candidateRef: candidate.body.resultRef, approvalRef: approval.body.resultRef },
            "admin",
            (await current()).headers.etag,
          );
          const before = await current();
          await ok(
            `${project}/onboarding/evaluations`,
            {
              gateKind: "L0",
              projectRegistryRef: before.body.projectRegistryRef,
              starterEntitlementSetHash: before.body.starterEntitlementSetHash,
              bindingRef,
              qaProjectContextRef: contextRef,
              requestedCapabilityMode: "MANUAL_ONLY",
            },
            "admin",
            before.headers.etag,
          );
          expect((await current()).body).toMatchObject({
            stage: "SHADOW",
            qaCapabilityMode: "MANUAL_ONLY",
            operationalState: "ACTIVE",
          });
          // Rehearse upgrade of a context published by the preceding release.
          await source.query("DELETE FROM qa_project_contexts WHERE id=$1", [contextRef.id]);
          const upgrade = readFileSync(
            new URL("../../../docs/runbooks/sql/qa-context-v2-identities.sql", import.meta.url),
            "utf8",
          );
          await source.query(upgrade);
          await source.query(upgrade);
          expect(
            await source.query(
              "SELECT count(*)::int AS n FROM qa_project_context_versions WHERE header_id=$1",
              [contextRef.id],
            ),
          ).toEqual([{ n: 0 }]);
          const input = await prepareManualRequest(source, scope, {
              bindingRef,
              environmentRef,
              dataRef,
              contextRef,
              policy,
            }),
            sessions = `${project}/work-items/${input.workItemId}/qa/sessions`;
          const automated = {
            workItemId: input.workItemId,
            suiteBindingRef: { id: randomUUID(), version: 1 },
            target: { type: "COMMIT", commitSha: "a".repeat(40) },
            environmentRef: "local@1",
            parameters: {},
          };
          expect(
            await request(`${project}/qa/automated-sessions`, automated, "executor"),
          ).toMatchObject({ status: 409, body: { code: "AUTOMATION_REQUIRES_FULL_QA" } });
          const created = await ok(
              sessions,
              { requiredSessionRequirementRef: input.requirementRef },
              "executor",
              '"1"',
            ),
            sessionId = String(created.body.sessionId);
          await ok(
            `${sessions}/${sessionId}/plan-items`,
            {
              title: "Manual check",
              expectedOutcome: "Expected result",
              definition: {
                kind: "session-plan-item-snapshot",
                snapshotHash: created.body.structureHash,
              },
            },
            "executor",
            '"1"',
          );
          const ready = await ok(
            `${sessions}/${sessionId}/transitions`,
            { requestedState: "READY" },
            "executor",
            '"2"',
          );
          const start = {
            requestedState: "RUNNING",
            targetInputFingerprint: ready.body.targetSnapshotHash,
            scopeInputFingerprint: ready.body.scopeSnapshotHash,
            expectedStructureHash: ready.body.structureHash,
          };
          await source.query(
            "CREATE FUNCTION fail_journey_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''controlled audit failure''; END'",
          );
          await source.query(
            "CREATE TRIGGER fail_journey_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_journey_audit()",
          );
          expect(
            (
              await request(
                `${sessions}/${sessionId}/transitions`,
                start,
                "executor",
                ready.headers.etag,
              )
            ).status,
          ).toBe(500);
          expect((await ok(`${sessions}/${sessionId}`, undefined, "executor")).body.state).toBe(
            "READY",
          );
          expect(
            await source.query(
              "SELECT count(*)::int AS n FROM qa_target_snapshots_v2 WHERE session_id=$1",
              [sessionId],
            ),
          ).toEqual([{ n: 0 }]);
          await source.query("DROP TRIGGER fail_journey_audit ON audit_events");
          await source.query("DROP FUNCTION fail_journey_audit()");
          expect(
            (
              await ok(
                `${sessions}/${sessionId}/transitions`,
                start,
                "executor",
                ready.headers.etag,
              )
            ).body.state,
          ).toBe("RUNNING");
          const snapshots = () =>
            source.query(
              "SELECT semantic_body FROM qa_target_snapshots_v2 WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
              [scope.workspaceId, projectId, sessionId],
            ) as Promise<{ semantic_body: Record<string, unknown> }[]>;
          const [snapshot] = await snapshots();
          expect(snapshot).toBeDefined();
          expect(() =>
            designContractRegistry.validateById(
              "urn:awp:schemas:007:target-snapshot:v2",
              snapshot!.semantic_body,
            ),
          ).not.toThrow();
          expect(snapshot!.semantic_body).toMatchObject({
            mode: "MANUAL",
            environmentRef,
            testDataRefs: [dataRef],
            configurationPins: expect.arrayContaining([expect.objectContaining({ bindingRef })]),
          });
          await api.close();
          api = await startOnboardingProcess(postgres.url, providerUrl, "api");
          await worker.close();
          worker = await startOnboardingProcess(postgres.url, providerUrl, "worker");
          expect((await ok(`${sessions}/${sessionId}`, undefined, "executor")).body.state).toBe(
            "RUNNING",
          );
          expect(await snapshots()).toEqual([snapshot]);
          expect(await worker.send("run")).toEqual({ completed: 0, rejected: 0, probes: 0 });
          expect(
            (await ok(base, registration, "owner", undefined, "journey-register")).body,
          ).toEqual(registered.body);
          expect(
            await source.query(
              "SELECT count(*)::int AS n FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND mode='AUTOMATED'",
              [scope.workspaceId, projectId],
            ),
          ).toEqual([{ n: 0 }]);
          expect(providerCalls).toHaveLength(4);
          expect(
            await source.query(
              "SELECT count(*)::int AS n FROM connector_commands WHERE workspace_id=$1 AND project_id=$2",
              [scope.workspaceId, projectId],
            ),
          ).toEqual([{ n: 0 }]);
          await ok(
            `${project}/qa/environments`,
            { ...envBody, name: "New environment revision" },
            "admin",
            '"1"',
          );
          expect(
            await request(
              sessions,
              { requiredSessionRequirementRef: input.requirementRef },
              "executor",
              '"1"',
            ),
          ).toMatchObject({ status: 409, body: { code: "QA_SESSION_ONBOARDING_NOT_READY" } });
          expect(await snapshots()).toEqual([snapshot]);
          const administrative = (await source.query(
            "SELECT attributes FROM audit_events WHERE workspace_id=$1 AND project_id=$2 AND attributes ? 'resultRef'",
            [scope.workspaceId, projectId],
          )) as { attributes: { before: ExactRevisionRef; after: ExactRevisionRef } }[];
          expect(administrative.length).toBeGreaterThan(10);
          for (const { attributes } of administrative) {
            expect(attributes.before).toMatchObject({
              id: expect.any(String),
              contentHash: expect.stringMatching(/^sha256:/),
            });
            expect(attributes.after.version).toBeGreaterThanOrEqual(attributes.before.version);
          }
          const audits = (await source.query(
            "SELECT actor,occurred_at,correlation_id,attributes FROM audit_events WHERE workspace_id=$1 AND project_id=$2",
            [scope.workspaceId, projectId],
          )) as {
            actor: unknown;
            occurred_at: Date;
            correlation_id: string;
            attributes: unknown;
          }[];
          expect(audits.length).toBeGreaterThan(10);
          for (const audit of audits) {
            expect(audit.actor).toBeTruthy();
            expect(audit.occurred_at).toBeInstanceOf(Date);
            expect(audit.correlation_id).toBeTruthy();
            expect(audit.attributes).toBeTruthy();
          }
        } finally {
          await api?.close();
          await worker?.close();
          if (source.isInitialized) await source.destroy();
          await postgres.stop();
          if (provider.listening)
            await new Promise<void>((resolve, reject) => {
              provider.close((error) => (error ? reject(error) : resolve()));
            });
        }
      },
      180_000,
    );
  },
);
