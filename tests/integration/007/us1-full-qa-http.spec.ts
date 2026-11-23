import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { qaValidationCapabilityRequirementSetV1 } from "../../../packages/competency-qa/src/node.ts";
import type { CapabilityProbeResult } from "../../../packages/platform-core/src/index.ts";
import { ProjectBindingRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createSafeCapabilityProbe } from "../../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import { createRequestedCapabilityProbeWorker } from "../../../packages/runtime-composition/src/onboarding/requested-probe-worker.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { publishFullQaResources, publishFullQaSuite } from "../../support/007-full-qa-http.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 accepted Suite FULL_QA HTTP",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "promotes only current accepted Suite and worker evidence, with replay and drift rejection on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          const resources = await publishFullQaResources(f),
            target = await f.coreDraft(true);
          const validation = await f.send(
            `bindings/${target.id}/validate`,
            {
              bindingVersion: 1,
              bindingContentHash: target.contentHash,
              probeKeys: qaValidationCapabilityRequirementSetV1.requirements
                .filter((r) => r.mode !== "PILOT_MESSAGING")
                .map((r) => r.requirementKey),
            },
            "validate-full-qa",
            1,
          );
          expect(validation).toMatchObject({
            status: 201,
            body: { outcome: "VALID", onboardingVersion: 6 },
          });
          const suite = await publishFullQaSuite(f, target, resources);
          const acceptance = {
            bindingRef: target,
            validationReportRef: validation.body.validationReportRef,
            qaProjectContextRef: resources.contextRef,
            acceptedResourceRefs: [suite.suiteRef, resources.environmentRef, resources.policy],
            checklistRef: resources.policy,
            outcome: "ACCEPTED",
            reason: "QA accepted the published local Suite and policies",
          };
          expect(
            await f.send(
              `bindings/${target.id}/acceptances`,
              {
                ...acceptance,
                acceptedResourceRefs: [
                  { ...suite.suiteRef, id: randomUUID() },
                  resources.environmentRef,
                  resources.policy,
                ],
              },
              "foreign-suite",
              1,
              "lead",
            ),
          ).toMatchObject({ status: 409 });
          const accepted = await f.send(
            `bindings/${target.id}/acceptances`,
            acceptance,
            "accept-full-qa",
            1,
            "lead",
          );
          expect(accepted, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { outcome: "ACCEPTED" },
          });
          const candidate = await f.send(
            "binding-candidates",
            { operation: "publish", bindingRef: target, reason: "Publish full QA binding" },
            "publish-full-qa",
            6,
          );
          expect(candidate).toMatchObject({ status: 202 });
          const approval = await f.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "approve-full-qa",
            6,
            "owner",
          );
          expect(approval).toMatchObject({ status: 202 });
          expect(
            await f.send(
              `bindings/${target.id}/publish`,
              { candidateRef: candidate.body.resultRef, approvalRef: approval.body.resultRef },
              "apply-full-qa",
              6,
            ),
          ).toMatchObject({ status: 202, body: { version: 7 } });
          const evaluation = {
            gateKind: "L0",
            projectRegistryRef: f.initial.projectRegistryRef,
            starterEntitlementSetHash: f.initial.starterEntitlementSetHash,
            bindingRef: target,
            qaProjectContextRef: resources.contextRef,
            requestedCapabilityMode: "FULL_QA",
          };
          expect(
            await f.send("onboarding/evaluations", evaluation, "full-qa-no-probes", 7),
          ).toMatchObject({
            status: 201,
            body: {
              outcome: "BLOCKED_INPUT",
              stage: "NEEDS_FIX",
              capabilityMode: "MANUAL_ONLY",
              version: 8,
            },
          });
          // The API queued the exact 12 required operations. The bounded controlled SERVICE port observes them.
          let observations = 0;
          const worker = () =>
            createRequestedCapabilityProbeWorker(f.source, {
              deadlineMs: 1000,
              validForMs: 120_000,
              authorize: async () => true,
              observe: async () => {
                observations++;
                return { status: "AVAILABLE", safeIssueCodes: [] };
              },
            });
          expect(await worker().run()).toEqual({ completed: 1, rejected: 0, probes: 12 });
          expect(observations).toBe(12);
          await f.source.query(
            "CREATE FUNCTION fail_full_qa_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ONBOARDING_L0_EVALUATED' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_full_qa_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_full_qa_audit()",
          );
          expect(
            await f.send("onboarding/evaluations", evaluation, "evaluate-full-qa", 8),
          ).toMatchObject({ status: 503 });
          expect(
            await f.source.query(
              "SELECT current_version,current_capability_mode FROM project_onboarding_headers WHERE project_id=$1",
              [f.scope.projectId],
            ),
          ).toEqual([{ current_version: 8, current_capability_mode: "MANUAL_ONLY" }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM project_onboarding_gate_results WHERE project_id=$1 AND check_key='onboarding-current-full-qa-facts' AND outcome='PASS'",
              [f.scope.projectId],
            ),
          ).toEqual([{ n: 0 }]);
          await f.source.query("DROP TRIGGER fail_full_qa_audit ON audit_events");
          const evaluated = await f.send(
            "onboarding/evaluations",
            evaluation,
            "evaluate-full-qa",
            8,
          );
          expect(evaluated, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: {
              outcome: "PASS",
              stage: "SHADOW",
              capabilityMode: "FULL_QA",
              version: 9,
              safeIssueCodes: [],
            },
          });
          const [gate] = (await f.source.query(
            "SELECT semantic_body FROM project_onboarding_gate_results WHERE gate_result_id=$1",
            [(evaluated.body.gateRef as { id: string }).id],
          )) as { semantic_body: { evidenceRefs: { id: string }[]; validUntil: string } }[];
          expect(gate!.semantic_body.evidenceRefs.map((r) => r.id)).toContain(suite.reportRef.id);
          expect(gate!.semantic_body.evidenceRefs).toHaveLength(14);
          const [expiry] = (await f.source.query(
            "SELECT min(valid_until) AS expires FROM capability_probe_results WHERE binding_ref->>'id'=$1",
            [target.id],
          )) as { expires: Date }[];
          expect(Date.parse(gate!.semantic_body.validUntil)).toBeLessThanOrEqual(
            expiry!.expires.getTime(),
          );
          await f.restart();
          expect(await f.send("onboarding/evaluations", evaluation, "evaluate-full-qa", 8)).toEqual(
            evaluated,
          );
          expect(await worker().run()).toEqual({ completed: 0, rejected: 0, probes: 0 });
          expect(observations).toBe(12);
          const [probe] = (await f.source.query(
            "SELECT semantic_body FROM capability_probe_results WHERE binding_ref->>'id'=$1 AND operation='pipeline.trigger' ORDER BY observed_at DESC LIMIT 1",
            [target.id],
          )) as { semantic_body: CapabilityProbeResult }[];
          const { contentHash: _hash, ...previousProbe } = probe!.semantic_body;
          void _hash;
          const unavailable = createSafeCapabilityProbe({
            ...previousProbe,
            probeId: randomUUID(),
            status: "UNAVAILABLE",
            safeIssueCodes: ["PROVIDER_UNAVAILABLE"],
            observedAt: new Date().toISOString(),
          });
          await new ProjectBindingRepository(f.source).appendCapabilityProbe(unavailable);
          expect(
            await f.send("onboarding/evaluations", evaluation, "full-qa-provider-unavailable", 9),
          ).toMatchObject({
            status: 201,
            body: {
              outcome: "BLOCKED_INPUT",
              capabilityMode: "MANUAL_ONLY",
              version: 10,
              safeIssueCodes: ["AUTOMATION_CAPABILITY_UNAVAILABLE"],
            },
          });
          // A current Suite head disappearing invalidates FULL_QA but leaves the manual mode evaluable.
          await f.source.query(
            "UPDATE qa_automation_suite_bindings SET current_published_version_id=NULL,current_published_version=NULL WHERE suite_binding_id=$1",
            [suite.header.id],
          );
          expect(
            await f.send("onboarding/evaluations", evaluation, "drifted-full-qa", 10),
          ).toMatchObject({
            status: 201,
            body: {
              outcome: "BLOCKED_INPUT",
              stage: "NEEDS_FIX",
              capabilityMode: "MANUAL_ONLY",
              version: 11,
            },
          });
          expect(
            await f.send(
              "onboarding/evaluations",
              { ...evaluation, requestedCapabilityMode: "MANUAL_ONLY" },
              "manual-after-suite-drift",
              11,
            ),
          ).toMatchObject({
            status: 201,
            body: { outcome: "PASS", capabilityMode: "MANUAL_ONLY", version: 12 },
          });
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE action='ONBOARDING_L0_EVALUATED' AND project_id=$1",
              [f.scope.projectId],
            ),
          ).toEqual([{ n: 5 }]);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
  },
);
