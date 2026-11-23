import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { digest, ref } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { qaValidationCapabilityRequirementSetV1 } from "../../../packages/competency-qa/src/node.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import type { ExactRevisionRef } from "../../../packages/platform-core/src/index.ts";
import { createRequestedCapabilityProbeWorker } from "../../../packages/runtime-composition/src/onboarding/requested-probe-worker.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import {
  assertPublishedRequest,
  assertPublishedResponse,
  publishedOperationIds,
} from "../../support/007-openapi.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const covered = new Set<string>();
const checked = (
  operation: string,
  response: Awaited<ReturnType<Awaited<ReturnType<typeof startBindingHttpFixture>>["apiRequest"]>>,
) => {
  assertPublishedResponse(operation, response);
  if (response.status < 300) covered.add(operation);
  return response;
};
const packageSchema = "urn:awp:schemas:007:project-onboarding-package:v1";
const validate = (schema: string, body: Record<string, unknown>) => {
  expect(() => designContractRegistry.validateById(schema, body)).not.toThrow();
  const { contentHash, ...semantic } = body;
  expect(contentHash).toBe(digest(semantic));
};
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 published onboarding HTTP contract",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "returns versioned packages and entitlement snapshots, enforces CAS and preserves replay on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image, "SHADOW", { globalProblemFilter: true });
        try {
          // This contract fixture provisions a complete onboarding snapshot only for its own project.
          // Shared-team seed now exposes other bare projects; exclude those unprovisioned fixture resources.
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=clock_timestamp() WHERE principal_id=$1 AND project_id<>$2",
            [localPersonaIds["owner.local"], f.scope.projectId],
          );
          const unauthorized = checked(
            "getProjectOnboarding",
            await f.apiRequest(
              `/${f.scope.projectId}/onboarding`,
              "GET",
              undefined,
              "invalid-token",
            ),
          );
          expect(unauthorized.status).toBe(401);
          const initial = checked(
            "getProjectOnboarding",
            await f.apiRequest(`/${f.scope.projectId}/onboarding`),
          );
          expect(initial).toMatchObject({
            status: 200,
            headers: { etag: '"1"', "cache-control": "private, no-store" },
          });
          validate(packageSchema, initial.body);
          const owners = Object.fromEntries(
            ["business", "technical", "qa", "security", "escalation"].map((k) => [
              k,
              localPersonaIds["owner.local"],
            ]),
          );
          const input = {
            key: "PUBLISHED",
            name: "Published HTTP project",
            ownerIds: owners,
            criticalityKey: "STANDARD",
            dataClassificationKey: "INTERNAL",
            reason: "Published contract journey",
          };
          assertPublishedRequest("registerProject", input);
          const invalid = checked(
            "registerProject",
            await f.apiRequest(
              "",
              "POST",
              { ...input, reason: undefined },
              "owner",
              "invalid-published-schema",
            ),
          );
          expect(invalid.status).toBe(400);
          const created = checked(
            "registerProject",
            await f.apiRequest("", "POST", input, "owner", "published-registration"),
          );
          expect(created).toMatchObject({ status: 201, headers: { etag: '"1"' } });
          validate(packageSchema, created.body);
          const projectId = String(created.body.projectId),
            path = `/${projectId}/entitlements`;
          const grant = {
            principalId: localPersonaIds["executor.alpha"],
            operation: "GRANT",
            effect: "ALLOW",
            permissions: ["project.onboarding.read"],
            classificationCeilingKey: "INTERNAL",
            validFrom: new Date(Date.now() - 1000).toISOString(),
            reason: "Scoped grant",
          };
          expect(
            await f.apiRequest(path, "POST", grant, "owner", "missing-grant-cas"),
          ).toMatchObject({
            status: 400,
            headers: { "content-type": expect.stringContaining("application/problem+json") },
            body: { code: "STRONG_IF_MATCH_REQUIRED", correlationId: expect.any(String) },
          });
          assertPublishedRequest("grantProjectEntitlement", grant);
          const granted = checked(
            "grantProjectEntitlement",
            await f.apiRequest(path, "POST", grant, "owner", "published-grant", '"1"'),
          );
          expect(granted).toMatchObject({
            status: 201,
            headers: { etag: '"1"' },
            body: { version: 1, operation: "GRANT" },
          });
          validate("urn:awp:schemas:007:project-entitlement-revision:v1", granted.body);
          expect(
            await f.apiRequest(path, "POST", grant, "owner", "stale-published-grant", '"1"'),
          ).toMatchObject({ status: 409 });
          const current = await f.apiRequest(`/${projectId}/onboarding`);
          expect(current).toMatchObject({
            status: 200,
            headers: { etag: '"2"' },
            body: { version: 2 },
          });
          validate(packageSchema, current.body);
          await f.restart();
          const replay = await f.apiRequest("", "POST", input, "owner", "published-registration");
          expect(replay.body).toEqual(created.body);
          expect(replay.headers.etag).toBe('"1"');
          expect(
            (await f.apiRequest(path, "POST", grant, "owner", "published-grant", '"1"')).body,
          ).toEqual(granted.body);
          const replaced = checked(
            "replaceProjectEntitlement",
            await f.apiRequest(
              `${path}/${granted.body.entitlementId}/replace`,
              "POST",
              { ...grant, operation: "REPLACE" },
              "owner",
              "published-replace",
              '"1"',
            ),
          );
          expect(replaced.body.version).toBe(2);
          const revoked = await f.apiRequest(
            `${path}/${granted.body.entitlementId}/revoke`,
            "POST",
            { reason: "End grant" },
            "owner",
            "published-revoke",
            '"2"',
          );
          checked("revokeProjectEntitlement", revoked);
          expect(revoked).toMatchObject({
            status: 200,
            headers: { etag: '"3"' },
            body: { operation: "REVOKE", version: 3 },
          });
          validate("urn:awp:schemas:007:project-entitlement-revision:v1", revoked.body);
          const catalog = checked("listAuthorizedProjects", await f.apiRequest("?limit=100"));
          expect(catalog.status).toBe(200);
          for (const item of catalog.body.items as Record<string, unknown>[])
            validate(packageSchema, item);
          expect(
            (catalog.body.items as Record<string, unknown>[]).map((i) => i.projectId),
          ).toContain(projectId);
          // The second administrator inherits access as part of the common team. Verify live revocation.
          expect(
            (await f.apiRequest(`/${projectId}/onboarding`, "GET", undefined, "admin")).status,
          ).toBe(200);
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=clock_timestamp() WHERE principal_id=$1 AND project_id=$2",
            [localPersonaIds["integration-admin.alpha"], projectId],
          );
          const denied = checked(
            "getProjectOnboarding",
            await f.apiRequest(`/${projectId}/onboarding`, "GET", undefined, "admin"),
          );
          expect(denied).toMatchObject({
            status: 404,
            body: { code: "PROJECT_RESOURCE_NOT_AVAILABLE" },
          });
          expect(Object.keys(denied.body).sort()).toEqual([
            "code",
            "correlationId",
            "status",
            "title",
            "type",
          ]);
          expect((await f.request(`/${projectId}/onboarding`)).body).toMatchObject({
            project: { id: projectId, key: "PUBLISHED" },
          });
        } finally {
          await f.close();
        }
      },
      180_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "serves QA resources, leases, validation, acceptance and L0 with exact contract refs on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image, "SHADOW", { globalProblemFilter: true });
        try {
          const base = `/${f.scope.projectId}`,
            ownerPrincipalId = localPersonaIds["lead.alpha"],
            policy = ref("controlled-policy", 1, digest({ policy: "local" }));
          const send = async (
            operation: string,
            path: string,
            body: unknown,
            version?: number,
            token = "admin",
            key: string = randomUUID(),
          ) => {
            assertPublishedRequest(operation, body);
            const result = await f.apiRequest(
              base + path,
              "POST",
              body,
              token,
              key,
              version ? `"${version}"` : undefined,
            );
            expect(result, f.errors.join("; ")).toMatchObject({ status: expect.any(Number) });
            checked(operation, result);
            expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
            return result;
          };
          const pin = (response: Awaited<ReturnType<typeof send>>) =>
            JSON.parse(response.headers["awp-resource-ref"]!) as ExactRevisionRef;
          const config = {
            key: "local-environment",
            schemaRef: { id: "controlled-schema", version: 1, digest: digest({ type: "object" }) },
            resourceRef: ref("local-runtime", 1, digest({ local: true })),
          };
          const envBody = {
            environmentId: randomUUID(),
            key: "published-env",
            name: "Published environment",
            scope: "LOCAL",
            ownerPrincipalId,
            dataClassificationKey: "INTERNAL",
            configurationRef: config,
            allowedTestDataPolicyRefs: [policy],
            reason: "Contract proof",
          };
          const environment = await send(
              "publishProjectEnvironment",
              "/qa/environments",
              envBody,
              undefined,
              "admin",
              "published-first-environment",
            ),
            env = pin(environment);
          await send(
            "publishProjectEnvironment",
            "/qa/environments",
            { ...envBody, name: "Second immutable environment" },
            1,
          );
          const currentEnvironment = (await f.source.query(
            "SELECT semantic_body FROM qa_project_environment_revisions WHERE environment_id=$1 AND version=2",
            [env.id],
          )) as { semantic_body: { contentHash: `sha256:${string}` } }[];
          const environmentRef = ref(env.id, 2, currentEnvironment[0]!.semantic_body.contentHash);
          const data = await send("publishQaProjectResource", "/qa/resources/test-data", {
            kind: "DATASET",
            resourceId: randomUUID(),
            externalRef: ref("data", 1, digest({ local: true })),
            ownerPrincipalId,
            allowedEnvironmentRefs: [environmentRef],
            dataClassificationKey: "INTERNAL",
            retentionPolicyRef: policy,
          });
          const inventory = {
            id: "local-http-accounts",
            version: 1,
            ...f.scope,
            opaqueAccountRefs: ["accountref://controlled/account-1"],
          };
          const pool = await send("publishQaProjectResource", "/qa/resources/account-pools", {
            kind: "ACCOUNT_POOL",
            resourceId: randomUUID(),
            environmentRef,
            resolverRef: {
              ...config,
              key: "file-account-inventory",
              resourceRef: ref(inventory.id, 1, digest(inventory)),
            },
            ownerPrincipalId,
            maximumConcurrentLeases: 1,
            maximumLeaseDurationSeconds: 300,
            dataClassificationKey: "INTERNAL",
          });
          const context = await send(
            "publishQaProjectContext",
            "/qa/context",
            {
              environmentRefs: [environmentRef],
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
              reason: "Publish context",
            },
            1,
          );
          const contextRef = pin(context),
            [item] = (await f.source.query(
              "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 LIMIT 1",
              [f.scope.workspaceId, f.scope.projectId],
            )) as { id: string }[];
          const lease = await send(
            "acquireTestAccountLease",
            "/qa/account-leases",
            {
              environmentRef,
              accountPoolRef: pool.body.resultRef,
              subjectRef: `work-item:${item!.id}`,
              purpose: "Published lease",
              requestedUntil: new Date(Date.now() + 120_000).toISOString(),
            },
            undefined,
            "executor",
          );
          await send(
            "releaseTestAccountLease",
            `/qa/account-leases/${lease.body.leaseId}/release`,
            { reason: "Release contract lease" },
            1,
            "executor",
          );
          const binding = await f.coreDraft(),
            validationBody = {
              bindingVersion: 1,
              bindingContentHash: binding.contentHash,
              probeKeys: qaValidationCapabilityRequirementSetV1.requirements
                .filter((r) => r.mode === "MANUAL")
                .map((r) => r.requirementKey),
            };
          const invalidVersion = checked(
            "validateBinding",
            await f.apiRequest(
              base + `/bindings/${binding.id}/validate`,
              "POST",
              { ...validationBody, bindingVersion: "1" },
              "admin",
              "published-invalid-version",
              '"1"',
            ),
          );
          expect(invalidVersion).toMatchObject({
            status: 400,
            body: { code: "HTTP_COMMAND_SCHEMA_INVALID" },
          });
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM integration_validation_reports WHERE subject_id=$1",
              [binding.id],
            ),
          ).toEqual([{ n: 0 }]);
          const validation = await send(
            "validateBinding",
            `/bindings/${binding.id}/validate`,
            validationBody,
            1,
          );
          expect(validation.body.state).toBe("ACCEPTED");
          expect(validation.headers.etag).toBe('"2"');
          const acceptanceBody = {
            bindingRef: binding,
            validationReportRef: validation.body.resultRef,
            qaProjectContextRef: contextRef,
            acceptedResourceRefs: [environmentRef],
            checklistRef: policy,
            outcome: "ACCEPTED",
            reason: "QA accepted exact published environment",
          };
          const accepted = await send(
            "acceptBindingFunctionally",
            `/bindings/${binding.id}/acceptances`,
            acceptanceBody,
            undefined,
            "lead",
            "published-first-acceptance",
          );
          expect(accepted.body).toMatchObject({
            schemaVersion: 2,
            acceptedResourceRefs: [environmentRef],
            reason: acceptanceBody.reason,
          });
          const candidate = await f.send(
            "binding-candidates",
            { operation: "publish", bindingRef: binding, reason: "Published binding" },
            "contract-binding-candidate",
            7,
          );
          expect(candidate.status).toBe(202);
          const approval = await f.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "contract-binding-approval",
            7,
            "owner",
          );
          expect(approval.status).toBe(202);
          await send(
            "applyBindingLifecycleAction",
            `/bindings/${binding.id}/publish`,
            { candidateRef: candidate.body.resultRef, approvalRef: approval.body.resultRef },
            7,
          );
          const evaluationBody = {
            gateKind: "L0",
            projectRegistryRef: f.initial.projectRegistryRef,
            starterEntitlementSetHash: f.initial.starterEntitlementSetHash,
            bindingRef: binding,
            qaProjectContextRef: contextRef,
            requestedCapabilityMode: "MANUAL_ONLY",
          };
          const blocked = await send(
            "evaluateProjectOnboarding",
            "/onboarding/evaluations",
            evaluationBody,
            8,
          );
          expect(blocked.body.state).toBe("REJECTED");
          expect(
            await createRequestedCapabilityProbeWorker(f.source, {
              deadlineMs: 1000,
              validForMs: 120_000,
              authorize: async () => true,
              observe: async () => ({ status: "AVAILABLE", safeIssueCodes: [] }),
            }).run(),
          ).toEqual({ completed: 1, rejected: 0, probes: 4 });
          const evaluation = await send(
            "evaluateProjectOnboarding",
            "/onboarding/evaluations",
            evaluationBody,
            9,
          );
          expect(evaluation.body.state).toBe("COMPLETED");
          const before = accepted.body;
          await f.restart();
          expect(
            (
              await send(
                "publishProjectEnvironment",
                "/qa/environments",
                envBody,
                undefined,
                "admin",
                "published-first-environment",
              )
            ).body,
          ).toEqual(environment.body);
          expect(
            (
              await send(
                "acceptBindingFunctionally",
                `/bindings/${binding.id}/acceptances`,
                acceptanceBody,
                undefined,
                "lead",
                "published-first-acceptance",
              )
            ).body,
          ).toEqual(accepted.body);
          // The public hash covers the wire DTO; canonical references still resolve the original Core record.
          const [row] = (await f.source.query(
            "SELECT semantic_body FROM binding_functional_acceptances WHERE acceptance_id=$1",
            [before.acceptanceId],
          )) as { semantic_body: { contentHash: string } }[];
          expect(JSON.parse(accepted.headers["awp-resource-ref"]!).contentHash).toBe(
            row!.semantic_body.contentHash,
          );
          expect(accepted.body.contentHash).not.toBe(row!.semantic_body.contentHash);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "returns suspend/resume and pilot packages under current distinct approvals on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image, "SHADOW", { globalProblemFilter: true });
        try {
          const base = `/${f.scope.projectId}`;
          const incident = { incidentRef: "INC-CONTRACT", reason: "Contain provider failure" };
          assertPublishedRequest("emergencySuspendProject", incident);
          const suspended = checked(
            "emergencySuspendProject",
            await f.apiRequest(
              base + "/operations/suspend",
              "POST",
              incident,
              "admin",
              "published-suspend",
              '"1"',
            ),
          );
          expect(suspended).toMatchObject({
            status: 200,
            headers: { etag: '"2"' },
            body: { operationalState: "SUSPENDED" },
          });
          validate(packageSchema, suspended.body);
          const disposition = await f.send(
            "operations/incident-dispositions",
            { incidentRef: incident.incidentRef, outcome: "ACCEPTED", reason: "Controlled repair" },
            "published-disposition",
            2,
          );
          const prepare = {
              incidentDispositionRef: disposition.body.resultRef,
              reason: "Resume with current observations",
            },
            candidate = await f.send(
              "operations/resume-candidates",
              prepare,
              "published-resume-candidate",
              2,
            );
          expect(candidate.status, f.errors.join("; ")).toBe(202);
          const approval = await f.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "published-resume-approval",
            2,
            "owner",
          );
          expect(approval.status).toBe(202);
          const resume = {
            ...prepare,
            incidentRef: incident.incidentRef,
            freshProbeRefs: (candidate.body.candidate as { freshProbeRefs: unknown })
              .freshProbeRefs,
            actionCandidateRef: candidate.body.resultRef,
            approvalRef: approval.body.resultRef,
          };
          assertPublishedRequest("resumeProject", resume);
          const resumed = checked(
            "resumeProject",
            await f.apiRequest(
              base + "/operations/resume",
              "POST",
              resume,
              "admin",
              "published-resume",
              '"2"',
            ),
          );
          expect(resumed).toMatchObject({
            status: 200,
            headers: { etag: '"3"' },
            body: { operationalState: "ACTIVE" },
          });
          validate(packageSchema, resumed.body);
          await f.restart();
          expect(
            (
              await f.apiRequest(
                base + "/operations/suspend",
                "POST",
                incident,
                "admin",
                "published-suspend",
                '"1"',
              )
            ).body,
          ).toEqual(suspended.body);
        } finally {
          await f.close();
        }
        const pilot = await startBindingHttpFixture(image, "SHADOW", { globalProblemFilter: true });
        try {
          await pilot.accept(pilot.bindingRef);
          await pilot.gates();
          const candidate = await pilot.send(
            "onboarding/pilot-candidates",
            { reason: "Activate controlled pilot" },
            "published-pilot-candidate",
            1,
          );
          expect(candidate.status).toBe(202);
          const approval = await pilot.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "published-pilot-approval",
            1,
            "owner",
          );
          expect(approval.status).toBe(202);
          const body = {
            candidateRef: candidate.body.resultRef,
            approvalRef: approval.body.resultRef,
          };
          assertPublishedRequest("activateProjectPilot", body);
          const activated = checked(
            "activateProjectPilot",
            await pilot.apiRequest(
              `/${pilot.scope.projectId}/onboarding/activate-pilot`,
              "POST",
              body,
              "admin",
              "published-activate-pilot",
              '"1"',
            ),
          );
          expect(activated).toMatchObject({
            status: 200,
            headers: { etag: '"2"' },
            body: { stage: "PILOT_ACTIVE" },
          });
          validate(packageSchema, activated.body);
        } finally {
          await pilot.close();
        }
      },
      180_000,
    );
    afterAll(() => expect([...covered].sort()).toEqual(publishedOperationIds));
  },
);
