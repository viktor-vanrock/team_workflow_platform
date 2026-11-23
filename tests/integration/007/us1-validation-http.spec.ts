import { describe, expect, it } from "vitest";

import { digest, ref } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 validation and acceptance HTTP",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "validates a durable draft and requires current QA acceptance for publication on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          const target = await f.coreDraft();
          const body = {
            bindingVersion: target.version,
            bindingContentHash: target.contentHash,
            probeKeys: [],
          };
          const validation = await f.send(
            `bindings/${target.id}/validate`,
            body,
            "validate-http-binding",
            1,
          );
          expect(validation, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: {
              outcome: "VALID",
              bindingState: "VALIDATED",
              validationReportRef: expect.any(Object),
            },
          });
          const reportRef = validation.body.validationReportRef;
          await f.restart();
          expect(
            await f.send(`bindings/${target.id}/validate`, body, "validate-http-binding", 1),
          ).toEqual(validation);
          expect(
            (await f.send(`bindings/${target.id}/validate`, body, "stale-validate-binding", 1))
              .status,
          ).toBe(409);
          const acceptance = {
            bindingRef: target,
            validationReportRef: reportRef,
            qaProjectContextRef: f.contextRef,
            acceptedResourceRefs: [],
            checklistRef: ref("local-checklist", 1, digest({ checked: true })),
            outcome: "ACCEPTED",
            reason: "QA checked the exact local binding",
          };
          expect(
            (
              await f.send(
                `bindings/${target.id}/acceptances`,
                acceptance,
                "admin-acceptance-denied",
                1,
              )
            ).status,
          ).toBe(403);
          const accepted = await f.send(
            `bindings/${target.id}/acceptances`,
            acceptance,
            "qa-acceptance-http",
            1,
            "lead",
          );
          expect(accepted, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { outcome: "ACCEPTED" },
          });
          const candidate = await f.send(
            "binding-candidates",
            { operation: "publish", bindingRef: target, reason: "Publish HTTP validated binding" },
            "publish-validated-http",
            2,
          );
          expect(candidate).toMatchObject({ status: 202 });
          const approval = await f.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "approve-validated-http",
            2,
            "owner",
          );
          expect(approval).toMatchObject({ status: 202 });
          const published = await f.send(
            `bindings/${target.id}/publish`,
            { candidateRef: candidate.body.resultRef, approvalRef: approval.body.resultRef },
            "apply-validated-http",
            2,
          );
          expect(published).toMatchObject({ status: 202, body: { version: 3 } });
          const evaluation = {
            gateKind: "L0",
            projectRegistryRef: f.initial.projectRegistryRef,
            starterEntitlementSetHash: f.initial.starterEntitlementSetHash,
            bindingRef: target,
            qaProjectContextRef: f.contextRef,
            requestedCapabilityMode: "MANUAL_ONLY",
          };
          const blocked = await f.send(
            "onboarding/evaluations",
            evaluation,
            "evaluate-missing-probes",
            3,
          );
          expect(blocked).toMatchObject({
            status: 201,
            body: { outcome: "BLOCKED_INPUT", stage: "NEEDS_FIX", version: 4 },
          });
          await f.probe(target, reportRef as typeof target);
          const evaluated = await f.send(
            "onboarding/evaluations",
            evaluation,
            "evaluate-local-http",
            4,
          );
          expect(evaluated, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { outcome: "PASS", stage: "SHADOW", capabilityMode: "MANUAL_ONLY", version: 5 },
          });
          expect(
            (
              await f.send(
                "onboarding/evaluations",
                { ...evaluation, gateKind: "P3" },
                "cannot-fabricate-pilot",
                5,
              )
            ).status,
          ).toBe(422);
          await f.restart();
          expect(
            await f.send("onboarding/evaluations", evaluation, "evaluate-local-http", 4),
          ).toEqual(evaluated);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM integration_validation_reports WHERE subject_id=$1",
              [target.id],
            ),
          ).toEqual([{ n: 1 }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM binding_functional_acceptances WHERE binding_ref->>'id'=$1",
              [target.id],
            ),
          ).toEqual([{ n: 1 }]);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
  },
);
