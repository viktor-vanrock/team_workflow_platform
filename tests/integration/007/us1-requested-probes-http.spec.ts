import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import { createDevelopmentCapabilityProbeWorker } from "../../../packages/runtime-composition/src/pilot/development-probes.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

afterEach(() => vi.unstubAllEnvs());
const probeKeys = ["jira-qa-request-authority", "jira-source-context", "jira-defect-destination"];
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 requested capability probes through HTTP and durable worker",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "queues exact requests, survives restart, sanitizes failures and rechecks rights on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        let calls = 0,
          mode = "AVAILABLE";
        const server = createServer((request, response) => {
          calls++;
          let body = "";
          request.on("data", (chunk) => {
            body += String(chunk);
          });
          request.on("end", () => {
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({ status: mode, subjectHash: pilotContentHash(JSON.parse(body)) }),
            );
          });
        });
        await new Promise<void>((resolve) => {
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("PORT_REQUIRED");
        for (const [key, value] of Object.entries({
          AWP_ENVIRONMENT: "LOCAL",
          AWP_RUNTIME_PROFILE: "local",
          AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
          AWP_EXTERNAL_NETWORK_MODE: "deny",
          AWP_DATABASE_URL: f.postgres.url,
          AWP_MOCK_HUB_URL: `http://127.0.0.1:${address.port}`,
          AWP_PILOT_ADAPTER_MODE: "development",
        }))
          vi.stubEnv(key, value);
        const environment = loadEnvironment();
        // This is the registered development worker factory, including its real HTTP observer.
        const worker = () => ({
          run: async () =>
            (await createDevelopmentCapabilityProbeWorker(f.source, environment).run()).requests,
        });
        try {
          const target = await f.coreDraft(),
            body = {
              bindingVersion: target.version,
              bindingContentHash: target.contentHash,
              probeKeys,
            };
          expect(
            (
              await f.send(
                `bindings/${target.id}/validate`,
                { ...body, probeKeys: ["arbitrary-provider-operation"] },
                "bad-probe-selector",
                1,
              )
            ).status,
          ).toBe(400);
          await f.source.query(
            "CREATE FUNCTION fail_probe_request_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='BINDING_VALIDATION_RECORDED' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_probe_request_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_probe_request_audit()",
          );
          expect(
            (await f.send(`bindings/${target.id}/validate`, body, "requested-probe-command", 1))
              .status,
          ).toBe(503);
          expect(
            await f.source.query("SELECT request_id FROM capability_probe_requests"),
          ).toHaveLength(0);
          await f.source.query("DROP TRIGGER fail_probe_request_audit ON audit_events");
          const queued = await f.send(
            `bindings/${target.id}/validate`,
            body,
            "requested-probe-command",
            1,
          );
          expect(queued).toMatchObject({
            status: 201,
            body: { outcome: "VALID", probeRequestRef: expect.any(Object) },
          });
          expect(calls).toBe(0);
          await f.restart();
          expect(
            await f.send(`bindings/${target.id}/validate`, body, "requested-probe-command", 1),
          ).toEqual(queued);
          // A process died after claiming; two fresh workers compete for the expired lease.
          await f.source.query(
            "UPDATE capability_probe_requests SET state='RUNNING',claim_token=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
            [(queued.body.probeRequestRef as { id: string }).id],
          );
          const recovered = await Promise.all([worker().run(), worker().run()]);
          expect(recovered.reduce((n, result) => n + result.completed, 0)).toBe(1);
          expect(recovered.reduce((n, result) => n + result.probes, 0)).toBe(4);
          expect(calls).toBe(4);
          await expect(
            f.source.query(
              "UPDATE capability_probe_requests SET semantic_body='{}' WHERE request_id=$1",
              [(queued.body.probeRequestRef as { id: string }).id],
            ),
          ).rejects.toThrow("CAPABILITY_PROBE_REQUEST_IMMUTABLE");
          expect(await worker().run()).toMatchObject({ completed: 0 });
          const rows = (await f.source.query(
            "SELECT semantic_body FROM capability_probe_results WHERE validation_report_ref->>'id'=$1",
            [(queued.body.validationReportRef as { id: string }).id],
          )) as { semantic_body: { validationReportRef: unknown; status: string } }[];
          expect(rows).toHaveLength(4);
          expect(rows.every((row) => row.semantic_body.status === "AVAILABLE")).toBe(true);
          await f.restart();
          expect(await worker().run()).toMatchObject({ completed: 0 });
          expect(calls).toBe(4);
          mode = "UNAVAILABLE";
          expect(
            (await f.send(`bindings/${target.id}/validate`, body, "negative-provider-probe", 2))
              .status,
          ).toBe(201);
          expect(await worker().run()).toMatchObject({ completed: 1, probes: 4 });
          expect(calls).toBe(8);
          expect(
            (await f.send(`bindings/${target.id}/validate`, body, "revoked-provider-probe", 3))
              .status,
          ).toBe(201);
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.scope.workspaceId, f.scope.projectId, f.initial.actor.principalId],
          );
          expect(await worker().run()).toMatchObject({ rejected: 1, probes: 0 });
          expect(calls).toBe(8);
          expect(
            JSON.stringify(await f.source.query("SELECT * FROM capability_probe_requests")),
          ).not.toContain("PROVIDER_SECRET_CANARY");
        } finally {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
          });
          await f.close();
        }
      },
      180_000,
    );
  },
);
