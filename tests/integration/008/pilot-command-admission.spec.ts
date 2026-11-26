import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { StaticProjectEffectGuard } from "../../../packages/platform-core/src/commanding/project-effect-guard.ts";
import { pilotContentHash, type PilotRecord } from "../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  PilotCommandAdmissionRepository,
  PilotRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { M0245PilotCommandAdmission1700000000245 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0245-pilot-command-admission.ts";
import { M0250PilotFenceAction1700000000250 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0250-pilot-fence-action.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { createInitialPilotCohort } from "../../../packages/runtime-composition/src/pilot/cohort-service.ts";
import { runtimePersistence } from "../../../packages/runtime-composition/src/pilot/composition.ts";
import {
  createStoredPilotCommandEffectGuard,
  PilotEffectGuard,
} from "../../../packages/runtime-composition/src/pilot/effect-guard.ts";
import { PublishedPilotFence } from "../../../packages/runtime-composition/src/pilot/published-fence.ts";

let postgres: RunningPostgres;
let source: ReturnType<typeof createPlatformDataSource>;
const workspaceId = randomUUID(),
  projectId = randomUUID(),
  principalId = randomUUID();
const ref = { id: "approved", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "durable pilot command admission",
  () => {
    beforeAll(async () => {
      postgres = await startPostgres();
      const registry = runtimePersistence("qa-jira-gitlab-mattermost-test");
      source = createPlatformDataSource({
        url: postgres.url,
        entities: registry.entities,
        migrations: registry.migrations,
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      await source.query(
        "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'issuer',$2,'HUMAN','person')",
        [principalId, principalId],
      );
      await source.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'workspace','ACTIVE')",
        [workspaceId, workspaceId],
      );
      await source.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,$3,'project','ACTIVE','INTERNAL')",
        [projectId, workspaceId, projectId],
      );
    }, 120_000);
    afterAll(async () => {
      await source?.destroy();
      await postgres?.stop();
    });

    it("commits with the command, survives replay and rejects changes or unsafe rollback", async () => {
      const command = {
        ...InMemoryDurableCommandStore.readyFixture().command(),
        id: randomUUID(),
        workspaceId,
        projectId,
        payloadHash: ref.contentHash,
        targetHash: ref.contentHash,
        actor: { kind: "HUMAN" as const, principalId, issuer: "issuer", subject: principalId },
      };
      const admission = {
        commandId: command.id,
        payloadHash: command.payloadHash,
        targetHash: command.targetHash,
        expectedOnboardingVersion: 1,
        context: {
          principalId,
          purpose: "BUSINESS" as const,
          deploymentRef: ref,
          cohortRef: ref,
          fenceRef: ref,
        },
      };
      const repository = new PilotCommandAdmissionRepository(source);
      await source.transaction(async (manager) => {
        await repository.insert(manager, command, admission);
        await manager.query(
          `INSERT INTO connector_commands(id,workspace_id,project_id,actor,capability_key,
        capability_version,operation,target,payload,binding_ref,profile_ref,effect_idempotency_key,state,
        correlation_id,causation_id,created_at) VALUES($1,$2,$3,$4,'test','1','test','{}','{}','{}','{}',$5,'QUEUED',$6,$7,$8)`,
          [
            command.id,
            workspaceId,
            projectId,
            JSON.stringify(command.actor),
            command.id,
            randomUUID(),
            randomUUID(),
            command.createdAt,
          ],
        );
      });
      expect(await repository.load(command)).toEqual(admission);
      let authorized = true;
      const fence = {
        workspaceId,
        projectId,
        mode: "COHORT_WRITES" as const,
        fenceRef: ref,
        deploymentRef: ref,
        cohortRef: ref,
        projectIds: [projectId],
        principalIds: [principalId],
        environment: "NON_PROD" as const,
        startsAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        revoked: false,
        runtimeInstanceId: "worker",
      };
      const guard = new PilotEffectGuard(
        new StaticProjectEffectGuard({
          workspaceId,
          projectId,
          operationalState: "ACTIVE",
          onboardingVersion: 1,
        }),
        { current: async () => fence, authorize: async () => authorized },
        "worker",
        Date.now,
        { assertReady: async () => undefined },
      );
      const workerGuard = createStoredPilotCommandEffectGuard(source, guard);
      await workerGuard.assertCommandAllowed(command);
      await expect(
        workerGuard.assertCommandAllowed({ ...command, payloadHash: `sha256:${"b".repeat(64)}` }),
      ).rejects.toThrow("PILOT_COMMAND_ADMISSION_CONFLICT");
      await expect(
        workerGuard.assertCommandAllowed({ ...command, id: randomUUID() }),
      ).rejects.toThrow("PILOT_COMMAND_ADMISSION_CONFLICT");
      authorized = false;
      await expect(workerGuard.assertCommandAllowed(command)).rejects.toThrow(
        "PILOT_ACCESS_REVOKED",
      );
      await source.transaction(
        async (manager) => await repository.insert(manager, command, admission),
      );
      expect(
        await source.query("SELECT command_id FROM pilot_command_admissions WHERE command_id=$1", [
          command.id,
        ]),
      ).toHaveLength(1);
      await expect(
        source.transaction(
          async (manager) =>
            await repository.insert(manager, command, {
              ...admission,
              expectedOnboardingVersion: 2,
            }),
        ),
      ).rejects.toThrow("PILOT_COMMAND_ADMISSION_CONFLICT");
      await expect(
        source.query(
          "UPDATE pilot_command_admissions SET expected_onboarding_version=2 WHERE command_id=$1",
          [command.id],
        ),
      ).rejects.toThrow();
      const runner = source.createQueryRunner();
      try {
        await runner.startTransaction();
        await expect(new M0245PilotCommandAdmission1700000000245().down(runner)).rejects.toThrow(
          "PILOT_ADMISSION_ROLLBACK_REQUIRES_EXPLICIT_HANDLING",
        );
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it("rolls admission back when the command cannot be committed", async () => {
      const command = {
        ...InMemoryDurableCommandStore.readyFixture().command(),
        id: randomUUID(),
        workspaceId,
        projectId,
        payloadHash: ref.contentHash,
        targetHash: ref.contentHash,
        actor: { kind: "HUMAN" as const, principalId, issuer: "issuer", subject: principalId },
      };
      await expect(
        source.transaction(async (manager) => {
          await new PilotCommandAdmissionRepository(source).insert(manager, command, {
            commandId: command.id,
            payloadHash: command.payloadHash,
            targetHash: command.targetHash,
            expectedOnboardingVersion: 1,
            context: {
              principalId,
              purpose: "BUSINESS",
              deploymentRef: ref,
              cohortRef: ref,
              fenceRef: ref,
            },
          });
        }),
      ).rejects.toThrow();
      expect(await new PilotCommandAdmissionRepository(source).load(command)).toBeUndefined();
    });

    it("does not accept directly inserted fence and cohort without consumed approval", async () => {
      const repository = new PilotRepository(source);
      const cohortId = randomUUID(),
        fenceId = randomUUID();
      const onboardingId = randomUUID(),
        revisionId = randomUUID();
      const onboardingBody = {
        onboardingId,
        revisionId,
        workspaceId,
        projectId,
        version: 1,
        stage: "PILOT_ACTIVE",
        operationalState: "ACTIVE",
      };
      const onboardingHash = pilotContentHash(onboardingBody) as `sha256:${string}`;
      await source.query(
        `INSERT INTO project_onboarding_headers(onboarding_id,workspace_id,project_id,current_version,
      current_stage,current_capability_mode,current_operational_state,intended_capability_mode,created_at,updated_at)
      VALUES($1,$2,$3,1,'PILOT_ACTIVE','MANUAL_ONLY','ACTIVE','MANUAL_ONLY',clock_timestamp(),clock_timestamp())`,
        [onboardingId, workspaceId, projectId],
      );
      await source.query(
        `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,
      onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,binding_ref,
      qa_project_context_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,actor,correlation_id,created_at,semantic_body,content_hash)
      VALUES($1,$2,$3,$4,1,'PILOT_ACTIVE','MANUAL_ONLY','ACTIVE','MANUAL_ONLY','{}','{}','{}',$5,'[]',$5,'TEST','test','{}','test',clock_timestamp(),$6,$5)`,
        [
          revisionId,
          onboardingId,
          workspaceId,
          projectId,
          onboardingHash,
          JSON.stringify({ ...onboardingBody, contentHash: onboardingHash }),
        ],
      );
      const onboardingRef = { id: revisionId, version: 1, contentHash: onboardingHash };
      const cohort = createInitialPilotCohort({
        cohortId,
        projects: [{ workspaceId, projectId, onboardingRef }],
        userIds: [principalId],
        channelRefs: ["web"],
        environmentRefs: ["dev"],
        suiteRefs: ["suite"],
        gateRefs: (["L0", "C1", "N2", "P3"] as const).map((kind) => ({
          kind,
          id: kind,
          contentHash: ref.contentHash,
        })),
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2099-01-01T00:00:00.000Z",
        sponsorRef: "sponsor",
        qaLeadRef: "lead",
        onCallRef: "oncall",
        rollbackRunbookRef: "runbook",
        comparisonProtocolRef: { id: "protocol", contentHash: ref.contentHash },
      });
      const record = (id: string, kind: "COHORT" | "FENCE", body: unknown): PilotRecord => {
        const value = {
          id,
          kind,
          schemaVersion: 1 as const,
          version: 1,
          workspaceId,
          projectId,
          actorRef: principalId,
          correlationId: "test",
          createdAt: new Date().toISOString(),
          body,
        };
        return {
          ...value,
          contentHash: pilotContentHash(value),
          body: body as PilotRecord["body"],
        };
      };
      const cohortRecord = record(cohortId, "COHORT", cohort);
      await repository.publish(cohortRecord, 0);
      const fence = record(fenceId, "FENCE", {
        schemaVersion: 1,
        mode: "COHORT_WRITES",
        environment: "NON_PROD",
        deploymentRef: ref,
        cohortRef: { id: cohortId, version: 1, contentHash: cohortRecord.contentHash },
        runtimeInstanceId: randomUUID(),
        startsAt: cohort.startAt,
        expiresAt: cohort.endAt,
        revoked: false,
      });
      await repository.publish(fence, 0);
      const reader = new PublishedPilotFence(source, workspaceId, [projectId]);
      expect(await reader.current({ workspaceId, projectId })).toBeUndefined();
      const { contentHash: _priorHash, ...oldCohort } = cohort;
      void _priorHash;
      const revokedBody = {
        ...oldCohort,
        version: 2,
        state: "REVOKED",
        predecessorHash: cohort.contentHash,
      };
      const revoked = { ...revokedBody, contentHash: pilotContentHash(revokedBody) };
      const { contentHash: _recordHash, ...oldRecord } = cohortRecord;
      void _recordHash;
      const nextRecord = {
        ...oldRecord,
        version: 2,
        body: revoked as unknown as PilotRecord["body"],
      };
      await repository.publish({ ...nextRecord, contentHash: pilotContentHash(nextRecord) }, 1);
      expect(await reader.current({ workspaceId, projectId })).toBeUndefined();
    });

    it("accepts the new action kind and refuses destructive migration rollback", async () => {
      const actionId = randomUUID();
      await source.query(
        `INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,created_at)
      VALUES($1,$2,$3,'PILOT_FENCE_PUBLISH','{}',$4,'PENDING',clock_timestamp())`,
        [actionId, workspaceId, projectId, ref.contentHash],
      );
      await source.query(
        `INSERT INTO project_operational_action_candidates(action_id,workspace_id,project_id,action_kind,
      target_ref,expected_onboarding_version,prerequisite_refs,initiator,reason,expires_at,created_at,semantic_body,content_hash)
      VALUES($1,$2,$3,'PILOT_FENCE_PUBLISH','{}',1,'[]','{}','test',clock_timestamp()+interval '5 minutes',clock_timestamp(),'{}',$4)`,
        [actionId, workspaceId, projectId, ref.contentHash],
      );
      const runner = source.createQueryRunner();
      try {
        await runner.startTransaction();
        await expect(new M0250PilotFenceAction1700000000250().down(runner)).rejects.toThrow(
          "PILOT_FENCE_ACTION_ROLLBACK_REQUIRES_EXPLICIT_HANDLING",
        );
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
