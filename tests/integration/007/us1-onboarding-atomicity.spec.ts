import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { digest, ref } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 onboarding transaction rollback",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "rolls back registration, grants, resources and validation when audit fails on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          await f.source.query(
            "CREATE FUNCTION fail_onboarding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('PROJECT_REGISTERED','ENTITLEMENT_GRANT','QA_ENVIRONMENT_PUBLISHED','BINDING_VALIDATION_RECORDED') THEN RAISE EXCEPTION 'controlled onboarding audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_onboarding_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_onboarding_audit()",
          );
          const owner = localPersonaIds["owner.local"],
            owners = {
              business: owner,
              technical: owner,
              qa: owner,
              security: owner,
              escalation: owner,
            };
          const registration = {
            key: "ROLLBACK",
            name: "Rollback proof",
            ownerIds: owners,
            criticalityKey: "STANDARD",
            dataClassificationKey: "INTERNAL",
            reason: "Audit failure test",
          };
          expect(
            (await f.request("", "POST", registration, "owner", "rollback-registration")).status,
          ).toBe(503);
          expect(await f.source.query("SELECT id FROM projects WHERE key='ROLLBACK'")).toHaveLength(
            0,
          );
          const grant = {
            principalId: localPersonaIds["executor.alpha"],
            operation: "GRANT",
            effect: "ALLOW",
            permissions: ["project.catalog.read"],
            classificationCeilingKey: "INTERNAL",
            validFrom: new Date().toISOString(),
            reason: "Atomic grant",
          };
          expect(
            (await f.send("entitlements", grant, "rollback-entitlement", 1, "owner")).status,
          ).toBe(503);
          expect(
            await f.source.query(
              "SELECT entitlement_id FROM project_entitlement_headers WHERE workspace_id=$1 AND project_id=$2",
              [f.scope.workspaceId, f.scope.projectId],
            ),
          ).toHaveLength(0);
          const id = randomUUID(),
            policy = ref("local-policy", 1, digest({ policy: 1 }));
          const environment = {
            environmentId: id,
            key: "atomic-environment",
            name: "Atomic environment",
            scope: "LOCAL",
            ownerPrincipalId: owner,
            dataClassificationKey: "INTERNAL",
            configurationRef: {
              key: "local",
              schemaRef: { id: "local-schema", version: 1, digest: policy.contentHash },
              resourceRef: policy,
            },
            allowedTestDataPolicyRefs: [policy],
            reason: "Atomic environment",
          };
          expect(
            (await f.send("qa/environments", environment, "rollback-environment", 1)).status,
          ).toBe(503);
          expect(
            await f.source.query(
              "SELECT environment_id FROM qa_project_environment_headers WHERE environment_id=$1",
              [id],
            ),
          ).toHaveLength(0);
          const target = await f.coreDraft(),
            validate = { bindingVersion: 1, bindingContentHash: target.contentHash, probeKeys: [] };
          expect(
            (await f.send(`bindings/${target.id}/validate`, validate, "rollback-validation", 1))
              .status,
          ).toBe(503);
          expect(
            await f.source.query(
              "SELECT status FROM project_integration_binding_revisions WHERE header_id=$1",
              [target.id],
            ),
          ).toEqual([{ status: "DRAFT" }]);
          expect(
            await f.source.query(
              "SELECT id FROM integration_validation_reports WHERE subject_id=$1",
              [target.id],
            ),
          ).toHaveLength(0);
          expect(
            await f.source.query(
              "SELECT current_version FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2",
              [f.scope.workspaceId, f.scope.projectId],
            ),
          ).toEqual([{ current_version: 1 }]);
          expect(
            await f.source.query(
              "SELECT result_ref FROM client_request_idempotency WHERE client_key LIKE 'rollback-%'",
            ),
          ).toHaveLength(0);
          await f.source.query("DROP TRIGGER fail_onboarding_audit ON audit_events");
          await f.restart();
          expect(
            (await f.request("", "POST", registration, "owner", "rollback-registration")).status,
          ).toBe(201);
          expect(
            (await f.send(`bindings/${target.id}/validate`, validate, "rollback-validation", 1))
              .status,
          ).toBe(201);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
  },
);
