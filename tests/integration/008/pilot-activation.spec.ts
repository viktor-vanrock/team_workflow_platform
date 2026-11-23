import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createProjectActionCandidate,
  type ExactRevisionRef,
  type ProjectActionApproval,
  type ProjectActionCandidate,
  type ProjectOnboardingRevision,
} from "../../../packages/platform-core/src/index.ts";
import { createOnboardingRevision } from "../../../packages/platform-core/src/project-onboarding/model.ts";
import {
  type DurablePilotActivationPort,
  type DurablePilotActivationReceipt,
  DurablePilotActivationService,
  type DurablePilotActivationTransaction,
  type PilotGateResult,
  PostgresDurablePilotActivationPort,
  type WorkspaceRolloutLease,
} from "../../../packages/runtime-composition/src/onboarding/action-consumers.ts";
import { startUs3DatabaseFixture, stopUs3DatabaseFixture } from "../../support/002-us3-database.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

const now = "2026-09-03T10:00:00.000Z";
const expiresAt = "2026-09-03T12:00:00.000Z";

const shadow = (): ProjectOnboardingRevision =>
  createOnboardingRevision({
    revisionId: "onboarding-project-a-3",
    onboardingId: "onboarding-project-a",
    version: 3,
    ...projectScope(onboardingFixture.projectA),
    stage: "SHADOW",
    qaCapabilityMode: "FULL_QA",
    operationalState: "ACTIVE",
    intendedCapabilityMode: "FULL_QA",
    projectRegistryRef: exactRef("registry-a"),
    bindingRef: exactRef("binding-a"),
    qaProjectContextRef: exactRef("context-a"),
    starterEntitlementSetHash: testHash("starter"),
    gateResultRefs: [exactRef("l0-old")],
    ownerSetHash: testHash("owners"),
    reasonCode: "SHADOW_READY",
    reason: "Ready for exact activation",
    actor: humanActor(),
    correlationId: onboardingFixture.correlationId,
    createdAt: "2026-09-03T09:00:00.000Z",
  });

function activationFixture() {
  const current = shadow();
  const gates: PilotGateResult[] = (["C1", "N2", "P3"] as const).map((kind) => ({
    kind,
    outcome: "PASS",
    ref: exactRef(`gate-${kind}`),
  }));
  const refs = [...gates.map((gate) => gate.ref), exactRef("config"), exactRef("cohort")];
  const action = createProjectActionCandidate({
    actionId: "action-pilot-a",
    kind: "ONBOARDING_PILOT_ACTIVATE",
    ...projectScope(onboardingFixture.projectA),
    targetRef: {
      id: current.revisionId,
      version: current.version,
      contentHash: current.contentHash,
    },
    expectedOnboardingVersion: current.version,
    prerequisiteRefs: refs,
    initiator: humanActor(
      onboardingFixture.integrationAdministratorId,
      "integration-administrator",
    ),
    reason: "Activate the bounded pilot",
    createdAt: now,
    expiresAt,
  });
  const approval: ProjectActionApproval = Object.freeze({
    approvalId: "approval-pilot-a",
    subjectKind: "PLATFORM_ACTION",
    actionKind: "ONBOARDING_PILOT_ACTIVATE",
    actionId: action.actionId,
    targetHash: action.contentHash,
    initiatorPrincipalId: action.initiator.principalId,
    approver: humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
    stepUpAt: now,
    approvedAt: now,
    expiresAt,
  });
  return { current, gates, refs, action, approval };
}

interface MemoryState {
  current: ProjectOnboardingRevision;
  actions: Map<string, ProjectActionCandidate>;
  approvals: Map<string, ProjectActionApproval>;
  refs: ExactRevisionRef[];
  gates: PilotGateResult[];
  lease?: WorkspaceRolloutLease;
  receipts: Map<string, DurablePilotActivationReceipt>;
  audits: unknown[];
  outbox: unknown[];
}

class MemoryActivationPort implements DurablePilotActivationPort {
  state: MemoryState;
  failCommit = false;
  #tail: Promise<void> = Promise.resolve();

  constructor() {
    const fixture = activationFixture();
    this.state = {
      current: fixture.current,
      actions: new Map([[fixture.action.actionId, fixture.action]]),
      approvals: new Map([[fixture.approval.approvalId, fixture.approval]]),
      refs: fixture.refs,
      gates: fixture.gates,
      receipts: new Map(),
      audits: [],
      outbox: [],
    };
  }

  async inTransaction<T>(
    _input: { workspaceId: string; projectId: string; expectedOnboardingVersion: number },
    work: (transaction: DurablePilotActivationTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = turn;
    await previous;
    const snapshot = structuredClone(this.state);
    try {
      const tx: DurablePilotActivationTransaction = {
        committed: async (actionId) => this.state.receipts.get(actionId),
        currentOnboarding: async () => this.state.current,
        action: async (actionId) => this.state.actions.get(actionId),
        approval: async (approvalId) => this.state.approvals.get(approvalId),
        currentPrerequisites: async () => ({
          refs: this.state.refs,
          gates: this.state.gates,
          initiatorAuthorized: true,
          approverAuthorized: true,
        }),
        acquireRolloutLease: async (input) => {
          const current = this.state.lease;
          if (
            current &&
            current.projectId !== this.state.current.projectId &&
            Date.parse(current.expiresAt) > Date.parse(input.acquiredAt)
          )
            throw new Error("ROLLOUT_LEASE_HELD");
          const lease = Object.freeze({
            ...projectScope(onboardingFixture.projectA),
            leaseVersion: (current?.leaseVersion ?? 0) + 1,
            actorId: input.actorId,
            acquiredAt: input.acquiredAt,
            expiresAt: input.expiresAt,
          });
          this.state.lease = lease;
          return lease;
        },
        commit: async (input) => {
          if (this.failCommit) throw new Error("SIMULATED_COMMIT_CRASH");
          this.state.current = input.revision;
          this.state.approvals.set(input.approval.approvalId, input.approval);
          this.state.audits.push(input.audit);
          this.state.outbox.push(input.outbox);
          this.state.receipts.set(
            input.action.actionId,
            Object.freeze({
              actionId: input.action.actionId,
              approvalId: input.approval.approvalId,
              revision: input.revision,
              lease: input.lease,
              replayed: false,
            }),
          );
        },
      };
      return await work(tx);
    } catch (error) {
      this.state = snapshot;
      throw error;
    } finally {
      release();
    }
  }
}

const request = {
  ...projectScope(onboardingFixture.projectA),
  actionId: "action-pilot-a",
  approvalId: "approval-pilot-a",
  expectedOnboardingVersion: 3,
  now,
};

describe("Feature 008 durable pilot activation", () => {
  it("serializes concurrent requests and consumes the same canonical action once", async () => {
    const port = new MemoryActivationPort();
    const service = new DurablePilotActivationService(port);
    const results = await Promise.all([service.activate(request), service.activate(request)]);
    expect(results.map((value) => value.replayed).sort()).toEqual([false, true]);
    expect(port.state.current.stage).toBe("PILOT_ACTIVE");
    expect(port.state.audits).toHaveLength(1);
    expect(port.state.outbox).toHaveLength(1);
    expect(port.state.approvals.get(request.approvalId)).toHaveProperty("consumedAt", now);
  });

  it("rolls back lease, approval, revision, audit and outbox after a transaction crash", async () => {
    const port = new MemoryActivationPort();
    const service = new DurablePilotActivationService(port);
    port.failCommit = true;
    await expect(service.activate(request)).rejects.toThrow("SIMULATED_COMMIT_CRASH");
    expect(port.state).toMatchObject({
      current: { stage: "SHADOW", version: 3 },
      audits: [],
      outbox: [],
    });
    expect(port.state.lease).toBeUndefined();
    expect(port.state.approvals.get(request.approvalId)).not.toHaveProperty("consumedAt");
    port.failCommit = false;
    await expect(service.activate(request)).resolves.toMatchObject({
      revision: { stage: "PILOT_ACTIVE" },
      replayed: false,
    });
  });

  it("fails closed on gate, config/cohort drift and approval expiry", async () => {
    const drift = new MemoryActivationPort();
    drift.state.refs = [...drift.state.refs.slice(0, -1), exactRef("cohort-new")];
    await expect(new DurablePilotActivationService(drift).activate(request)).rejects.toThrow(
      "PROJECT_ACTION_PREREQUISITE_STALE",
    );

    const blocked = new MemoryActivationPort();
    blocked.state.gates = blocked.state.gates.map((gate) =>
      gate.kind === "N2" ? { ...gate, outcome: "BLOCKED_INPUT" } : gate,
    );
    await expect(new DurablePilotActivationService(blocked).activate(request)).rejects.toThrow(
      "PILOT_GATE_BLOCKED",
    );

    const expired = new MemoryActivationPort();
    await expect(
      new DurablePilotActivationService(expired).activate({
        ...request,
        now: "2026-09-03T12:00:01.000Z",
      }),
    ).rejects.toThrow("APPROVAL_EXPIRED");
  });
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "Feature 008 PostgreSQL pilot activation UoW",
  () => {
    it("commits one lease, approval, revision, audit and outbox under concurrent replay", async () => {
      const fixture = await startUs3DatabaseFixture();
      try {
        const registry = (
          (await fixture.source.query(
            "SELECT revision_id,content_hash FROM project_registry_revisions WHERE workspace_id=$1 AND project_id=$2 AND version=1",
            [fixture.workspaceId, fixture.projectId],
          )) as { revision_id: string; content_hash: `sha256:${string}` }[]
        )[0]!;
        const initiatorId = randomUUID(),
          approverId = randomUUID();
        await fixture.source.query(
          "INSERT INTO identities(id,issuer,subject,kind,display_name,row_version,created_at) VALUES($1,'fixture','pilot-initiator','HUMAN','Pilot initiator',1,now()),($2,'fixture','pilot-approver','HUMAN','Pilot approver',1,now())",
          [initiatorId, approverId],
        );
        const current = createOnboardingRevision({
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          onboardingId: fixture.projectId,
          revisionId: randomUUID(),
          version: 3,
          stage: "SHADOW",
          qaCapabilityMode: "FULL_QA",
          operationalState: "ACTIVE",
          intendedCapabilityMode: "FULL_QA",
          projectRegistryRef: {
            id: registry.revision_id,
            version: 1,
            contentHash: registry.content_hash,
          },
          bindingRef: exactRef(randomUUID()),
          qaProjectContextRef: exactRef(randomUUID()),
          starterEntitlementSetHash: testHash("starter-postgres"),
          gateResultRefs: [exactRef("l0")],
          ownerSetHash: testHash("owners-postgres"),
          reasonCode: "SHADOW_READY",
          reason: "PostgreSQL activation fixture",
          actor: humanActor(initiatorId, "integration-administrator"),
          correlationId: randomUUID(),
          createdAt: "2026-09-03T09:00:00.000Z",
        });
        await fixture.source.query(
          `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,binding_ref,qa_project_context_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,incident_ref,actor,correlation_id,causation_id,created_at,semantic_body,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,$18,$19,NULL,$20,$21,$22)`,
          [
            current.revisionId,
            current.onboardingId,
            current.workspaceId,
            current.projectId,
            current.version,
            current.stage,
            current.qaCapabilityMode,
            current.operationalState,
            current.intendedCapabilityMode,
            JSON.stringify(current.projectRegistryRef),
            JSON.stringify(current.bindingRef),
            JSON.stringify(current.qaProjectContextRef),
            current.starterEntitlementSetHash,
            JSON.stringify(current.gateResultRefs),
            current.ownerSetHash,
            current.reasonCode,
            current.reason,
            JSON.stringify(current.actor),
            current.correlationId,
            current.createdAt,
            JSON.stringify(current),
            current.contentHash,
          ],
        );
        await fixture.source.query(
          "UPDATE project_onboarding_headers SET current_version=3,current_stage='SHADOW',current_capability_mode='FULL_QA',current_operational_state='ACTIVE',intended_capability_mode='FULL_QA' WHERE workspace_id=$1 AND project_id=$2",
          [fixture.workspaceId, fixture.projectId],
        );
        const gates: PilotGateResult[] = (["C1", "N2", "P3"] as const).map((kind) => ({
          kind,
          outcome: "PASS",
          ref: exactRef(`postgres-gate-${kind}`),
        }));
        const refs = [
          ...gates.map((gate) => gate.ref),
          exactRef("postgres-config"),
          exactRef("postgres-cohort"),
        ];
        const action = createProjectActionCandidate({
          actionId: randomUUID(),
          kind: "ONBOARDING_PILOT_ACTIVATE",
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          targetRef: {
            id: current.revisionId,
            version: current.version,
            contentHash: current.contentHash,
          },
          expectedOnboardingVersion: 3,
          prerequisiteRefs: refs,
          initiator: humanActor(initiatorId, "integration-administrator"),
          reason: "Activate PostgreSQL pilot",
          createdAt: now,
          expiresAt,
        });
        const approval: ProjectActionApproval = {
          approvalId: randomUUID(),
          subjectKind: "PLATFORM_ACTION",
          actionKind: action.kind,
          actionId: action.actionId,
          targetHash: action.contentHash,
          initiatorPrincipalId: initiatorId,
          approver: humanActor(approverId, "workspace-owner"),
          stepUpAt: now,
          approvedAt: now,
          expiresAt,
        };
        await fixture.source.query(
          "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,row_version,created_at) VALUES($1,$2,$3,'ONBOARDING_PILOT_ACTIVATE',$4,$5,'PENDING',1,$6)",
          [
            action.actionId,
            fixture.workspaceId,
            fixture.projectId,
            JSON.stringify(action),
            action.contentHash,
            now,
          ],
        );
        await fixture.source.query(
          "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,row_version,created_at) VALUES($1,$2,$3,'ONBOARDING_PILOT_ACTIVATE',$4,$5,$6,'APPROVED','AUTHORIZED',$7,$8,$9,1,$10)",
          [
            approval.approvalId,
            fixture.workspaceId,
            fixture.projectId,
            action.actionId,
            JSON.stringify(approval),
            action.contentHash,
            initiatorId,
            approverId,
            expiresAt,
            now,
          ],
        );
        const service = new DurablePilotActivationService(
          new PostgresDurablePilotActivationPort(fixture.source, async () => ({
            refs,
            gates,
            initiatorAuthorized: true,
            approverAuthorized: true,
          })),
        );
        const input = {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          actionId: action.actionId,
          approvalId: approval.approvalId,
          expectedOnboardingVersion: 3,
          now,
        };
        const results = await Promise.all([service.activate(input), service.activate(input)]);
        expect(results.map((value) => value.replayed).sort()).toEqual([false, true]);
        expect(
          await fixture.source.query("SELECT state FROM platform_actions WHERE id=$1", [
            action.actionId,
          ]),
        ).toEqual([{ state: "COMPLETED" }]);
        expect(
          await fixture.source.query(
            "SELECT effect_authorization_state FROM approvals WHERE id=$1",
            [approval.approvalId],
          ),
        ).toEqual([{ effect_authorization_state: "CONSUMED" }]);
        expect(
          await fixture.source.query(
            "SELECT current_version,current_stage FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2",
            [fixture.workspaceId, fixture.projectId],
          ),
        ).toEqual([{ current_version: 4, current_stage: "PILOT_ACTIVE" }]);
        expect(
          await fixture.source.query(
            "SELECT id FROM audit_events WHERE action='ONBOARDING_PILOT_ACTIVATE' AND causation_id=$1",
            [action.actionId],
          ),
        ).toHaveLength(1);
        expect(
          await fixture.source.query(
            "SELECT id FROM event_outbox WHERE event_type='PROJECT_ONBOARDING_CHANGED' AND envelope->'payload'->>'causationId'=$1",
            [action.actionId],
          ),
        ).toHaveLength(1);
      } finally {
        await stopUs3DatabaseFixture(fixture);
      }
    }, 120_000);
  },
);
