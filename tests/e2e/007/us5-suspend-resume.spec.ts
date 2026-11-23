import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/index.ts";
import {
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { startEffectWorker } from "../../support/007-child-worker.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 suspend between intent and effect: independent API/PostgreSQL/worker",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "cancels a claimed command, survives restart and requires approved resume on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image, "PILOT_ACTIVE");
        const effects: string[] = [];
        const provider = createServer((request, response) => {
          if (request.method !== "POST") {
            response.writeHead(405).end();
            return;
          }
          request.resume();
          effects.push(String(request.headers["idempotency-key"]));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ confirmed: true }));
        });
        await new Promise<void>((resolve) => {
          provider.listen(0, "127.0.0.1", resolve);
        });
        const address = provider.address();
        if (!address || typeof address === "string") throw new Error("PROVIDER_PORT_REQUIRED");
        const providerUrl = `http://127.0.0.1:${address.port}`;
        let worker: Awaited<ReturnType<typeof startEffectWorker>> | undefined;
        const commands = new TypeOrmCommandRepository(f.source);
        const enqueue = async () => {
          const sample = InMemoryDurableCommandStore.readyFixture().command();
          const command = {
            ...sample,
            ...f.scope,
            id: randomUUID(),
            correlationId: randomUUID(),
            causationId: randomUUID(),
            bindingRef: f.bindingRef,
            profileRef: f.profileRef,
            actor: {
              kind: "HUMAN" as const,
              principalId: f.initial.actor.principalId,
              issuer: "fixture",
              subject: f.initial.actor.principalId,
            },
            status: "QUEUED" as const,
            outboxStatus: "READY" as const,
            effectAuthorizationStatus: "NOT_REQUIRED" as const,
            effectIdempotencyKey: randomUUID(),
          };
          await f.source.transaction(async (manager) => {
            await new TypeOrmCommandRepository(f.source).insert(command, manager);
            await new TypeOrmCommandOutboxRepository(f.source).insert(
              {
                id: randomUUID(),
                commandId: command.id,
                ...f.scope,
                state: "READY",
                availableAt: new Date(),
                attempts: 0,
                envelopeHash: command.payloadHash,
                createdAt: new Date(),
              },
              manager,
            );
          });
          return command;
        };
        try {
          const pending = await enqueue();
          worker = await startEffectWorker(f.postgres.url, providerUrl);
          const originalPid = worker.pid;
          expect(originalPid).not.toBe(process.pid);
          expect(await worker.send("claim")).toMatchObject({ commandId: pending.id });
          expect(effects).toHaveLength(0);
          const suspended = await f.send(
            "operations/suspend",
            { incidentRef: "INC-PROCESS", reason: "Suspend after worker claim" },
            "process-suspend-request",
            1,
          );
          expect(suspended).toMatchObject({
            status: 202,
            body: { state: "SUSPENDED", version: 2 },
          });
          await expect(worker.send("dispatch")).rejects.toThrow(
            /COMMAND_OUTBOX_STATE_CONFLICT|COMMAND_DELIVERY_STATE_CONFLICT/,
          );
          expect(
            await commands.get(f.scope.workspaceId, f.scope.projectId, pending.id),
          ).toMatchObject({ status: "CANCELLED", outboxStatus: "DEAD" });
          await worker.close();
          worker = undefined;
          await f.restart();
          worker = await startEffectWorker(f.postgres.url, providerUrl);
          expect(worker.pid).not.toBe(originalPid);
          expect(await worker.send("claim")).toMatchObject({ commandId: null });
          expect(effects).toHaveLength(0);
          const disposition = await f.send(
            "operations/incident-dispositions",
            {
              incidentRef: "INC-PROCESS",
              outcome: "ACCEPTED",
              reason: "Controlled provider recovered",
            },
            "process-incident-decision",
            2,
          );
          expect(disposition.status).toBe(202);
          const prepare = {
            incidentDispositionRef: disposition.body.resultRef,
            reason: "Resume with current observations",
          };
          const candidate = await f.send(
            "operations/resume-candidates",
            prepare,
            "process-resume-candidate",
            2,
          );
          expect(candidate.status).toBe(202);
          expect(
            (
              await f.send(
                "operations/approvals",
                { candidateRef: candidate.body.resultRef },
                "process-self-approval",
                2,
              )
            ).status,
          ).toBe(403);
          const approval = await f.send(
            "operations/approvals",
            { candidateRef: candidate.body.resultRef },
            "process-owner-approval",
            2,
            "owner",
          );
          expect(approval.status).toBe(202);
          const resume = {
            ...prepare,
            incidentRef: "INC-PROCESS",
            freshProbeRefs: (candidate.body.candidate as { freshProbeRefs: unknown })
              .freshProbeRefs,
            actionCandidateRef: candidate.body.resultRef,
            approvalRef: approval.body.resultRef,
          };
          const resumed = await f.send("operations/resume", resume, "process-approved-resume", 2);
          expect(resumed).toMatchObject({ status: 202, body: { state: "ACTIVE", version: 3 } });
          expect(await worker.send("claim")).toMatchObject({ commandId: null });
          const fresh = await enqueue();
          expect(await worker.send("claim")).toMatchObject({ commandId: fresh.id });
          expect(await worker.send("dispatch")).toMatchObject({ state: "CONFIRMED" });
          expect(effects).toEqual([fresh.effectIdempotencyKey]);
          await worker.close();
          worker = undefined;
          await f.restart();
          worker = await startEffectWorker(f.postgres.url, providerUrl);
          expect(await worker.send("claim")).toMatchObject({ commandId: null });
          expect(await f.send("operations/resume", resume, "process-approved-resume", 2)).toEqual(
            resumed,
          );
          expect(effects).toEqual([fresh.effectIdempotencyKey]);
          expect(
            await f.source.query(
              "SELECT action,count(*)::int AS n FROM audit_events WHERE action IN ('PROJECT_SUSPENDED','PROJECT_RESUMED') GROUP BY action ORDER BY action",
            ),
          ).toEqual([
            { action: "PROJECT_RESUMED", n: 1 },
            { action: "PROJECT_SUSPENDED", n: 1 },
          ]);
        } finally {
          await worker?.close();
          await new Promise<void>((resolve, reject) => {
            provider.close((error) => (error ? reject(error) : resolve()));
          });
          await f.close();
        }
      },
      180_000,
    );
  },
);
