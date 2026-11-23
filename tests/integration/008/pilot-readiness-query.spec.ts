import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  type ExactRevisionRef,
  gateRequirements,
  pilotContentHash,
  type PilotGateKind,
  type PilotRecord,
} from "../../../packages/platform-core/src/index.ts";
import { PilotRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createCapabilityProbeMaintenanceWorker } from "../../../packages/runtime-composition/src/pilot/maintenance-probes.ts";
import { currentQaCommandAuthority } from "../../../packages/runtime-composition/src/pilot/qa-command-authority.ts";
import { PilotReadinessQuery } from "../../../packages/runtime-composition/src/pilot/readiness-query.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { seed008CapabilityPlan } from "../../support/008-capability-plan.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

it("authorizes readiness and health before transaction or resource lookup", async () => {
  const transaction = vi.fn();
  const query = new PilotReadinessQuery(
    { transaction } as never,
    { current: vi.fn() },
    { isCurrent: vi.fn() },
  );
  const authority = {
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    authorize: async () => {
      throw new Error("REVOKED");
    },
  };
  await expect(query.health(authority)).rejects.toThrow("REVOKED");
  await expect(query.readiness(authority, randomUUID())).rejects.toThrow("REVOKED");
  expect(transaction).not.toHaveBeenCalled();
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 current readiness projections",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "derives current health from exact Core probes and blocks stale gate/input evidence on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        const scope = { workspaceId: f.workspaceId, projectId: f.projectId };
        let now = Date.now();
        let inputUnavailable = false;
        let inputExpired = false;
        let gateVerified = true;
        const ref = (id: string): ExactRevisionRef => ({
          id,
          version: 1,
          contentHash: pilotContentHash({ id }) as `sha256:${string}`,
        });
        const inputRef = ref("reviewed-input-package");
        const query = new PilotReadinessQuery(
          f.source,
          {
            current: async (_manager, currentScope, reference) => {
              if (inputUnavailable) throw new Error("RAW_INPUT_STORE_CANARY");
              expect(currentScope).toEqual(scope);
              expect(reference).toEqual(inputRef);
              return {
                ...scope,
                packageRef: inputRef,
                observedAt: new Date(now - 100).toISOString(),
                validUntil: new Date(now + (inputExpired ? 0 : 1000)).toISOString(),
                entries: Array.from({ length: 12 }, (_, i) => ({
                  id: `IN-${String(i + 1).padStart(2, "0")}`,
                  ownerRole: "Integration owner",
                  status: "PASS" as const,
                  reasonCodes: [],
                })),
              };
            },
          },
          { isCurrent: async () => gateVerified },
          () => now,
        );
        try {
          for (const table of ["role_assignments", "project_entitlements"])
            await f.source.query(
              `UPDATE ${table} SET permissions=permissions || '["pilot.health.read","pilot.readiness.read"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
              [f.workspaceId, f.projectId, us3Actor.principalId],
            );
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='CONFIDENTIAL',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, us3Actor.principalId],
          );
          const authority = currentQaCommandAuthority(f.source, scope, us3Actor, "CONFIDENTIAL");
          const pins = await seed008CapabilityPlan(f.source, scope);
          expect(
            (await query.health(authority)).capabilities.every(
              (value) => value.status === "UNKNOWN",
            ),
          ).toBe(true);
          const worker = createCapabilityProbeMaintenanceWorker(f.source, {
            refreshAfterMs: 1000,
            validForMs: 2000,
            deadlineMs: 100,
            now: () => new Date(now).toISOString(),
            authorize: async () => true,
            observe: async () => ({ status: "AVAILABLE", safeIssueCodes: [] }),
          });
          expect((await worker.run()).probes).toBeGreaterThanOrEqual(4);
          const healthy = await query.health(authority);
          expect(
            healthy.capabilities.filter(
              (value) => value.bindingRef.id === pins.bindingId && value.status === "AVAILABLE",
            ),
          ).toHaveLength(4);
          now += 2000;
          expect(
            (await query.health(authority)).capabilities.filter(
              (value) =>
                value.bindingRef.id === pins.bindingId &&
                value.reasonCodes.includes("CAPABILITY_PROBE_EXPIRED"),
            ),
          ).toHaveLength(4);
          await worker.run();
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=2 WHERE id=$1",
            [pins.profileId],
          );
          expect(
            (await query.health(authority)).capabilities
              .filter((value) => value.bindingRef.id === pins.bindingId)
              .every((value) => value.status === "UNKNOWN"),
          ).toBe(true);
          expect(
            await f.source.query(
              "SELECT probe_id FROM capability_probe_results WHERE binding_ref->>'id'=$1",
              [pins.bindingId],
            ),
          ).toHaveLength(8);
          await expect(
            query.health(
              currentQaCommandAuthority(
                f.source,
                { ...scope, projectId: randomUUID() },
                us3Actor,
                "CONFIDENTIAL",
              ),
            ),
          ).rejects.toThrow("QA_COMMAND_AUTHORITY_DENIED");

          const repository = new PilotRepository(f.source);
          const deploymentId = randomUUID();
          const publish = async (version: number) => {
            const body = {
              ...scope,
              id: deploymentId,
              version,
              schemaVersion: 1 as const,
              kind: "DEPLOYMENT" as const,
              actorRef: us3Actor.principalId,
              correlationId: "readiness-fixture",
              createdAt: new Date(now).toISOString(),
              body: { deploymentProfile: "pilot", inputPackageRef: { ...inputRef } },
            };
            const record: PilotRecord = { ...body, contentHash: pilotContentHash(body) };
            await repository.publish(record, version - 1);
            return {
              id: record.id,
              version,
              contentHash: record.contentHash as `sha256:${string}`,
            };
          };
          const deploymentRef = await publish(1);
          expect((await query.readiness(authority, deploymentId)).gateReady).toBe(false);
          for (const kind of ["L0", "C1", "N2", "P3"] as PilotGateKind[]) {
            await repository.recordOnboardingGate(
              {
                ...scope,
                id: randomUUID(),
                kind,
                subjectRef: deploymentRef,
                evaluatorId: randomUUID(),
                evaluatedAt: new Date(now).toISOString(),
                executions: gateRequirements[kind].map((key) => ({
                  ...scope,
                  id: randomUUID(),
                  version: 1,
                  key,
                  subjectRef: deploymentRef,
                  reportRef: ref(`fixture-${kind}-${key}`),
                  status: "PASS",
                  assessment: "CURRENT",
                  evaluatedAt: new Date(now).toISOString(),
                  validUntil: new Date(now + 1000).toISOString(),
                  checks: [{ id: "controlled-read-projection", status: "PASS" }],
                })),
              },
              { verify: async () => true },
            );
          }
          expect(await query.readiness(authority, deploymentId)).toMatchObject({
            gateReady: true,
            engineeringReady: true,
            corporateGatesReady: true,
          });
          gateVerified = false;
          expect(
            (await query.readiness(authority, deploymentId)).gates.every((value) =>
              value.reasonCodes.includes("GATE_EVIDENCE_UNVERIFIED"),
            ),
          ).toBe(true);
          gateVerified = true;
          inputExpired = true;
          expect((await query.readiness(authority, deploymentId)).gateReady).toBe(false);
          inputExpired = false;
          inputUnavailable = true;
          const unavailable = await query.readiness(authority, deploymentId);
          expect(unavailable.gateReady).toBe(false);
          expect(JSON.stringify(unavailable)).not.toContain("RAW_INPUT_STORE_CANARY");
          inputUnavailable = false;
          now += 1000;
          expect(
            (await query.readiness(authority, deploymentId)).gates.every((value) =>
              value.reasonCodes.includes("GATE_EVIDENCE_EXPIRED"),
            ),
          ).toBe(true);
          await publish(2);
          expect(
            (await query.readiness(authority, deploymentId)).gates.every((value) =>
              value.reasonCodes.includes("GATE_EVIDENCE_MISSING"),
            ),
          ).toBe(true);
          expect(
            await f.source.query("SELECT gate_result_id FROM project_onboarding_gate_results"),
          ).toHaveLength(4);
          await f.source.query(
            "UPDATE role_assignments SET revoked_at=now(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, us3Actor.principalId],
          );
          await expect(query.readiness(authority, deploymentId)).rejects.toThrow(
            "QA_COMMAND_AUTHORITY_DENIED",
          );
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
