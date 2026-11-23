import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Module,
  UnauthorizedException,
} from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import { OnboardingController } from "../../../apps/api/src/extensions/onboarding/onboarding.controller.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  ProjectOnboardingApplication,
  WorkspaceContextStore,
} from "../../../packages/platform-runtime-nest/src/index.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({})
class BindingProofModule {}
it("binding publication rejects unauthenticated requests before application dispatch", async () => {
  const app = await NestFactory.create<NestExpressApplication>(
    {
      module: BindingProofModule,
      controllers: [OnboardingController],
      providers: [
        QaSessionGuard,
        {
          provide: ProjectOnboardingApplication,
          useValue: { applyBindingAction: async () => ({ status: "ACCEPTED" }) },
        },
        {
          provide: WorkspaceContextStore,
          useValue: {
            current: () => ({
              scope: {
                kind: "PROJECT",
                workspaceId: "10000000-0000-4000-8000-000000000001",
                projectId: "20000000-0000-4000-8000-000000000001",
              },
            }),
          },
        },
        { provide: "VALIDATION_HTTP_APPLICATION", useValue: {} },
        { provide: "RESOURCES_HTTP_APPLICATION", useValue: {} },
        { provide: "REGISTRY_HTTP_APPLICATION", useValue: {} },
        { provide: QA_DATA_SOURCE, useValue: {} },
        { provide: "BINDING_HTTP_APPLICATION", useValue: {} },
        {
          provide: QA_HTTP_IDENTITY,
          useValue: {
            authenticate: () => {
              throw new UnauthorizedException();
            },
          },
        },
      ],
    },
    { logger: false, abortOnError: false },
  );
  try {
    await app.listen(0, "127.0.0.1");
    const response = await fetch(
      `${await app.getUrl()}/v1/workspaces/10000000-0000-4000-8000-000000000001/projects/20000000-0000-4000-8000-000000000001/bindings/30000000-0000-4000-8000-000000000001/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": '"1"',
          "idempotency-key": "unauthenticated-binding",
        },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(401);
  } finally {
    await app.close();
  }
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 durable binding lifecycle HTTP",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "clones history, consumes exact publication/retirement approval and replays after restart on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        const candidate = async (
          operation: string,
          bindingRef: unknown,
          key: string,
          version: number,
        ) =>
          f.send(
            "binding-candidates",
            { operation, bindingRef, reason: `Controlled ${operation}` },
            key,
            version,
          );
        const approve = async (candidateRef: unknown, key: string, version: number) =>
          f.send("operations/approvals", { candidateRef }, key, version, "owner");
        try {
          const body = {
            operation: "rollback",
            bindingRef: f.bindingRef,
            reason: "Clone reviewed history",
          };
          expect(
            (await f.send("binding-candidates", body, "weak-binding-etag", 1, "admin", 'W/"1"'))
              .status,
          ).toBe(400);
          expect(
            (await f.send("binding-candidates", body, "binding-mfa-required", 1, "no-mfa")).status,
          ).toBe(403);
          expect(
            (
              await candidate(
                "rollback",
                { ...f.bindingRef, id: randomUUID() },
                "foreign-binding-target",
                1,
              )
            ).status,
          ).toBe(404);
          const rollback = await candidate("rollback", f.bindingRef, "rollback-candidate", 1);
          expect(rollback, f.errors.join("; ")).toMatchObject({
            status: 202,
            body: { status: "PENDING_APPROVAL" },
          });
          expect(
            (
              await f.send(
                "operations/approvals",
                { candidateRef: rollback.body.resultRef },
                "binding-self-approval",
                1,
              )
            ).status,
          ).toBe(403);
          const rollbackApproval = await approve(rollback.body.resultRef, "approve-rollback", 1);
          expect(rollbackApproval.status).toBe(202);
          const exact = {
            candidateRef: rollback.body.resultRef,
            approvalRef: rollbackApproval.body.resultRef,
          };
          expect(
            (await f.send(`bindings/${f.bindingRef.id}/publish`, exact, "wrong-binding-action", 1))
              .status,
          ).toBe(409);
          const cloned = await f.send(
            `bindings/${f.bindingRef.id}/rollback`,
            exact,
            "clone-history-request",
            1,
          );
          expect(cloned, f.errors.join("; ")).toMatchObject({
            status: 202,
            body: { state: "DRAFT", version: 2, resultRef: { version: 2 } },
          });
          const target = cloned.body.resultRef;
          expect(
            await f.source.query(
              "SELECT version,status,content_hash FROM project_integration_binding_revisions WHERE header_id=$1 ORDER BY version",
              [f.bindingRef.id],
            ),
          ).toEqual([
            { version: 1, status: "PUBLISHED", content_hash: f.bindingRef.contentHash },
            { version: 2, status: "DRAFT", content_hash: f.bindingRef.contentHash },
          ]);
          expect((await candidate("publish", target, "missing-validation", 2)).status).toBe(409);
          await f.accept(target);
          const publication = await candidate("publish", target, "publication-candidate", 2);
          expect(publication, f.errors.join("; ")).toMatchObject({ status: 202 });
          const publicationApproval = await approve(
            publication.body.resultRef,
            "approve-publication",
            2,
          );
          expect(publicationApproval.status).toBe(202);
          const publicationCommand = {
            candidateRef: publication.body.resultRef,
            approvalRef: publicationApproval.body.resultRef,
          };
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=NULL WHERE id=$1",
            [f.profileRef.id],
          );
          expect(
            (
              await f.send(
                `bindings/${f.bindingRef.id}/publish`,
                publicationCommand,
                "stale-profile-publish",
                2,
              )
            ).status,
          ).toBe(409);
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
            [f.profileRef.id],
          );
          await f.source.query(
            "CREATE FUNCTION fail_binding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='BINDING_PUBLISHED' THEN RAISE EXCEPTION 'controlled binding audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_binding_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_binding_audit()",
          );
          expect(
            (
              await f.send(
                `bindings/${f.bindingRef.id}/publish`,
                publicationCommand,
                "atomic-binding-publish",
                2,
              )
            ).status,
          ).toBe(503);
          expect(
            await f.source.query(
              "SELECT current_published_version FROM project_integration_binding_headers WHERE id=$1",
              [f.bindingRef.id],
            ),
          ).toEqual([{ current_published_version: 1 }]);
          expect(
            await f.source.query("SELECT effect_authorization_state FROM approvals WHERE id=$1", [
              publicationApproval.body.resultRef.id,
            ]),
          ).toEqual([{ effect_authorization_state: "AUTHORIZED" }]);
          await f.source.query("DROP TRIGGER fail_binding_audit ON audit_events");
          await f.restart();
          const outcomes = await Promise.all([
            f.send(
              `bindings/${f.bindingRef.id}/publish`,
              publicationCommand,
              "publish-request-a",
              2,
            ),
            f.send(
              `bindings/${f.bindingRef.id}/publish`,
              publicationCommand,
              "publish-request-b",
              2,
            ),
          ]);
          expect(outcomes.map((r) => r.status).sort(), f.errors.join("; ")).toEqual([202, 409]);
          const winner = outcomes.findIndex((r) => r.status === 202),
            key = winner === 0 ? "publish-request-a" : "publish-request-b";
          expect(
            await f.send(`bindings/${f.bindingRef.id}/publish`, publicationCommand, key, 2),
          ).toEqual(outcomes[winner]);
          expect(
            await f.source.query(
              "SELECT version,status FROM project_integration_binding_revisions WHERE header_id=$1 ORDER BY version",
              [f.bindingRef.id],
            ),
          ).toEqual([
            { version: 1, status: "RETIRED" },
            { version: 2, status: "PUBLISHED" },
          ]);
          const retirement = await candidate("retire", target, "retirement-candidate", 3);
          expect(retirement.status).toBe(202);
          const retirementApproval = await approve(
            retirement.body.resultRef,
            "approve-retirement",
            3,
          );
          expect(retirementApproval.status).toBe(202);
          const retired = await f.send(
            `bindings/${f.bindingRef.id}/retire`,
            {
              candidateRef: retirement.body.resultRef,
              approvalRef: retirementApproval.body.resultRef,
            },
            "retire-current-binding",
            3,
          );
          expect(retired).toMatchObject({ status: 202, body: { state: "RETIRED", version: 4 } });
          expect(
            await f.source.query(
              "SELECT current_published_version FROM project_integration_binding_headers WHERE id=$1",
              [f.bindingRef.id],
            ),
          ).toEqual([{ current_published_version: null }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE action='BINDING_PUBLISHED'",
            ),
          ).toEqual([{ n: 1 }]);
          expect(
            await f.source.query(
              "SELECT semantic_body FROM project_onboarding_revisions WHERE revision_id=$1",
              [f.initial.revisionId],
            ),
          ).toEqual([{ semantic_body: f.initial }]);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "activates only current gates under an exact distinct approval and rollout lease on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          await f.accept(f.bindingRef);
          const body = { reason: "Activate controlled local pilot" };
          expect(
            (await f.send("onboarding/pilot-candidates", body, "missing-pilot-gates", 1)).status,
          ).toBe(409);
          await f.gates();
          const prepared = await f.send(
            "onboarding/pilot-candidates",
            body,
            "prepare-local-pilot",
            1,
          );
          expect(prepared, f.errors.join("; ")).toMatchObject({ status: 202 });
          const approved = await f.send(
            "operations/approvals",
            { candidateRef: prepared.body.resultRef },
            "approve-local-pilot",
            1,
            "owner",
          );
          expect(approved.status).toBe(202);
          const command = {
            candidateRef: prepared.body.resultRef,
            approvalRef: approved.body.resultRef,
          };
          const [other] = (await f.source.query(
            "SELECT id FROM projects WHERE workspace_id=$1 AND id<>$2 ORDER BY id LIMIT 1",
            [f.scope.workspaceId, f.scope.projectId],
          )) as { id: string }[];
          await f.source.query(
            "INSERT INTO workspace_project_rollout_leases(workspace_id,holder_project_id,lease_version,acquired_by,acquired_at,expires_at,purpose) VALUES($1,$2,1,$3,clock_timestamp(),clock_timestamp()+interval '5 minutes','FIRST_PILOT_ACTIVATION')",
            [f.scope.workspaceId, other!.id, f.initial.actor.principalId],
          );
          expect(
            (await f.send("onboarding/activate-pilot", command, "occupied-pilot-lease", 1)).status,
          ).toBe(409);
          expect(
            await f.source.query("SELECT effect_authorization_state FROM approvals WHERE id=$1", [
              approved.body.resultRef.id,
            ]),
          ).toEqual([{ effect_authorization_state: "AUTHORIZED" }]);
          await f.source.query(
            "DELETE FROM workspace_project_rollout_leases WHERE workspace_id=$1",
            [f.scope.workspaceId],
          );
          await f.source.query(
            "CREATE FUNCTION fail_pilot_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ONBOARDING_PILOT_ACTIVATED' THEN RAISE EXCEPTION 'controlled pilot audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_pilot_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_pilot_audit()",
          );
          expect(
            (await f.send("onboarding/activate-pilot", command, "atomic-pilot-request", 1)).status,
          ).toBe(503);
          expect(
            await f.source.query("SELECT workspace_id FROM workspace_project_rollout_leases"),
          ).toHaveLength(0);
          await f.source.query("DROP TRIGGER fail_pilot_audit ON audit_events");
          await f.restart();
          const activated = await f.send(
            "onboarding/activate-pilot",
            command,
            "activate-local-pilot",
            1,
          );
          expect(activated, f.errors.join("; ")).toMatchObject({
            status: 202,
            body: { stage: "PILOT_ACTIVE", version: 2, leaseVersion: 1 },
          });
          expect(
            await f.send("onboarding/activate-pilot", command, "activate-local-pilot", 1),
          ).toEqual(activated);
          expect(
            (await f.send("onboarding/activate-pilot", command, "activate-pilot-again", 1)).status,
          ).toBe(409);
          expect(
            await f.source.query(
              "SELECT holder_project_id FROM workspace_project_rollout_leases WHERE workspace_id=$1",
              [f.scope.workspaceId],
            ),
          ).toEqual([{ holder_project_id: f.scope.projectId }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE action='ONBOARDING_PILOT_ACTIVATED'",
            ),
          ).toEqual([{ n: 1 }]);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "refuses a newly failed gate after pilot approval on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          await f.accept(f.bindingRef);
          await f.gates();
          const candidate = await f.send(
            "onboarding/pilot-candidates",
            { reason: "Prepare before new result" },
            "prepare-negative-pilot",
            1,
          );
          expect(candidate, f.errors.join("; ")).toMatchObject({ status: 202 });
          const approval = await f.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "approve-negative-pilot",
            1,
            "owner",
          );
          expect(approval.status).toBe(202);
          await f.gates("FAIL");
          const result = await f.send(
            "onboarding/activate-pilot",
            { candidateRef: candidate.body.resultRef, approvalRef: approval.body.resultRef },
            "block-negative-pilot",
            1,
          );
          expect(result).toMatchObject({
            status: 409,
            body: { status: "CONFLICT", code: "PILOT_GATE_BLOCKED" },
          });
          expect(
            await f.source.query(
              "SELECT current_stage FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2",
              [f.scope.workspaceId, f.scope.projectId],
            ),
          ).toEqual([{ current_stage: "SHADOW" }]);
          expect(
            await f.source.query("SELECT effect_authorization_state FROM approvals WHERE id=$1", [
              approval.body.resultRef.id,
            ]),
          ).toEqual([{ effect_authorization_state: "AUTHORIZED" }]);
          expect(
            await f.source.query("SELECT workspace_id FROM workspace_project_rollout_leases"),
          ).toHaveLength(0);
        } finally {
          await f.close();
        }
      },
      180_000,
    );

    it.each(POSTGRES_TEST_IMAGES)(
      "retires the previous header when publishing a replacement binding on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          const target = await f.coreDraft(),
            id = target.id;
          await f.accept(target);
          const prepared = await f.send(
            "binding-candidates",
            { operation: "publish", bindingRef: target, reason: "Replace binding header" },
            "replace-header-candidate",
            1,
          );
          expect(prepared, f.errors.join("; ")).toMatchObject({ status: 202 });
          const approved = await f.send(
            "operations/approvals",
            { candidateRef: prepared.body.resultRef },
            "approve-new-header",
            1,
            "owner",
          );
          expect(approved.status).toBe(202);
          const result = await f.send(
            `bindings/${id}/publish`,
            { candidateRef: prepared.body.resultRef, approvalRef: approved.body.resultRef },
            "publish-replacement-header",
            1,
          );
          expect(result, f.errors.join("; ")).toMatchObject({ status: 202 });
          expect(
            await f.source.query(
              "SELECT current_published_version FROM project_integration_binding_headers WHERE id=$1",
              [f.bindingRef.id],
            ),
          ).toEqual([{ current_published_version: null }]);
          expect(
            await f.source.query(
              "SELECT header_id FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND status='PUBLISHED' AND header_id=ANY($3::uuid[])",
              [f.scope.workspaceId, f.scope.projectId, [id, f.bindingRef.id]],
            ),
          ).toEqual([{ header_id: id }]);
          const clone = await f.send(
            "binding-candidates",
            { operation: "rollback", bindingRef: target, reason: "Clone Core revision" },
            "clone-core-candidate",
            2,
          );
          expect(clone.status).toBe(202);
          const cloneApproval = await f.send(
            "operations/approvals",
            { candidateRef: clone.body.resultRef },
            "approve-core-clone",
            2,
            "owner",
          );
          expect(cloneApproval.status).toBe(202);
          const draft = await f.send(
            `bindings/${id}/rollback`,
            { candidateRef: clone.body.resultRef, approvalRef: cloneApproval.body.resultRef },
            "clone-core-history",
            2,
          );
          expect(draft, f.errors.join("; ")).toMatchObject({
            status: 202,
            body: { state: "DRAFT", version: 3, resultRef: { version: 2 } },
          });
          const accepted = await f.accept(draft.body.resultRef);
          const next = await f.send(
            "binding-candidates",
            {
              operation: "publish",
              bindingRef: draft.body.resultRef,
              reason: "Publish Core successor",
            },
            "publish-core-candidate",
            3,
          );
          expect(next.status).toBe(202);
          const nextApproval = await f.send(
            "operations/approvals",
            { candidateRef: next.body.resultRef },
            "approve-core-successor",
            3,
            "owner",
          );
          expect(nextApproval.status).toBe(202);
          expect(
            (
              await f.send(
                `bindings/${id}/publish`,
                { candidateRef: next.body.resultRef, approvalRef: nextApproval.body.resultRef },
                "publish-core-successor",
                3,
              )
            ).status,
          ).toBe(202);
          expect(
            (
              await f.send(
                "operations/suspend",
                { incidentRef: "INC-CORE", reason: "Controlled incident" },
                "suspend-core-binding",
                4,
              )
            ).status,
          ).toBe(202);
          const disposition = await f.send(
            "operations/incident-dispositions",
            { incidentRef: "INC-CORE", outcome: "ACCEPTED", reason: "Investigated incident" },
            "accept-core-incident",
            5,
          );
          expect(disposition.status).toBe(202);
          const freshProbeRefs = await f.probe(draft.body.resultRef, accepted.validationRef);
          const resume = await f.send(
            "operations/resume-candidates",
            {
              incidentDispositionRef: disposition.body.resultRef,
              reason: "Resume Core configuration",
            },
            "resume-core-candidate",
            5,
          );
          expect(resume, f.errors.join("; ")).toMatchObject({ status: 202 });
          const resumeApproval = await f.send(
            "operations/approvals",
            { candidateRef: resume.body.resultRef },
            "approve-core-resume",
            5,
            "owner",
          );
          expect(resumeApproval.status).toBe(202);
          expect(
            await f.send(
              "operations/resume",
              {
                incidentRef: "INC-CORE",
                incidentDispositionRef: disposition.body.resultRef,
                freshProbeRefs,
                actionCandidateRef: resume.body.resultRef,
                approvalRef: resumeApproval.body.resultRef,
                reason: "Resume Core configuration",
              },
              "resume-core-binding",
              5,
            ),
          ).toMatchObject({ status: 202, body: { state: "ACTIVE", version: 6 } });
        } finally {
          await f.close();
        }
      },
      180_000,
    );
  },
);
