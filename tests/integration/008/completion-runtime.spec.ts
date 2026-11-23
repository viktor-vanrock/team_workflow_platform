import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { authorizeQaApi } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { QaSessionReviewController } from "../../../apps/api/src/extensions/qa-session-review.controller.ts";
import { QaVerdictCompletionController } from "../../../apps/api/src/extensions/qa-verdict-completion.controller.ts";
import {
  createLocalQaDodRuntime,
  createLocalQaVerdictRuntime,
} from "../../../apps/api/src/local/local-qa-dod-runtime.ts";
import { createQaTypeOrmCompletionConfirmationHook } from "../../../packages/competency-qa/src/application/completion-confirmation-persistence.ts";
import {
  buildQaDodAssessment,
  type QaDodAssessment,
} from "../../../packages/competency-qa/src/domain/dod.ts";
import { qaAggregateSnapshotHash } from "../../../packages/competency-qa/src/domain/primitives.ts";
import type { ConfirmedOperationalEffect } from "../../../packages/platform-contracts/src/index.ts";
import type { CompleteOperationalObservation } from "../../../packages/platform-core/src/index.ts";
import {
  TypeOrmCommandDeliveryStore,
  TypeOrmCommandRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { DurableQaCompletionApprovalRuntime } from "../../../packages/runtime-composition/src/pilot/completion-approval-runtime.ts";
import { PublishedQaCompletionConfiguration } from "../../../packages/runtime-composition/src/pilot/completion-configuration.ts";
import { DurableQaCompletionRuntime } from "../../../packages/runtime-composition/src/pilot/completion-runtime.ts";
import { DurableQaCompletionWorker } from "../../../packages/runtime-composition/src/pilot/completion-worker.ts";
import { currentQaCommandAuthority } from "../../../packages/runtime-composition/src/pilot/qa-command-authority.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";
import {
  observe008Completion,
  prepare008CompletionProof,
  seed008CompletionConfiguration,
} from "../../support/008-completion.ts";
import { start008CompletionProvider } from "../../support/008-completion-provider.ts";
import { localQaTestRequest } from "../../support/008-qa-request.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let fixture: Us3DatabaseFixture | undefined;
async function claimReleasedCompletion(
  f: Us3DatabaseFixture,
  delivery: TypeOrmCommandDeliveryStore,
  commandId: string,
) {
  const [row] = (await f.source.query(
    "SELECT state,ceil(extract(epoch FROM available_at)*1000)::float8 AS available_ms FROM command_outbox WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3",
    [f.workspaceId, f.projectId, commandId],
  )) as [{ state: string; available_ms: number }];
  expect(row.state).toBe("READY");
  // PostgreSQL has microsecond precision and the Docker clock can lead the host.
  // Poll at the persisted eligibility boundary instead of assuming immediate host-clock eligibility.
  const now = new Date(Math.max(Date.now(), row.available_ms));
  const claim = (await delivery.claim(now, new Date(now.getTime() + 15_000), 20)).find(
    (value) => value.command.id === commandId,
  );
  expect(claim, "released completion must be due at its persisted availability time").toBeDefined();
  return claim!;
}
afterEach(async () => {
  await stopUs3DatabaseFixture(fixture);
  fixture = undefined;
});
describe.each(POSTGRES_TEST_IMAGES)("completion publication/approval %s", (postgresImage) => {
  it("pins confirmed state, commits one held command and releases it with an exact distinct approval", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const pins = await seed008CompletionConfiguration(f);
    const dod = createLocalQaDodRuntime(f.source);
    const configuration = new PublishedQaCompletionConfiguration(f.source, [pins]);
    const runtime = new DurableQaCompletionRuntime(f.source, dod, configuration);
    const approval = new DurableQaCompletionApprovalRuntime(f.source, runtime);
    const controller = new QaVerdictCompletionController(
      f.source,
      dod,
      runtime,
      approval,
      createLocalQaVerdictRuntime(f.source),
    );
    const assessment = await prepare008CompletionProof(f, controller);
    const authority = currentQaCommandAuthority(f.source, f, us3Actor, "INTERNAL");
    await expect(runtime.create(authority, f.workItemId, assessment)).rejects.toThrow(
      "QA_COMPLETION_PROJECTION_UNAVAILABLE",
    );
    const operationalBindingId = await observe008Completion(f, pins);
    const [observation] = (await f.source.query(
      "SELECT last_observed_at FROM operational_bindings WHERE id=$1",
      [operationalBindingId],
    )) as [{ last_observed_at: Date }];
    const boundary = new PublishedQaCompletionConfiguration(
      f.source,
      [{ ...pins, maximumProjectionAgeMs: 2 }],
      () => observation.last_observed_at.getTime() + 1,
    );
    await f.source.transaction((manager) => boundary.load(manager, f, f.workItemId));
    const expired = new PublishedQaCompletionConfiguration(
      f.source,
      [{ ...pins, maximumProjectionAgeMs: 2 }],
      () => observation.last_observed_at.getTime() + 2,
    );
    await expect(
      f.source.transaction((manager) => expired.load(manager, f, f.workItemId)),
    ).rejects.toThrow("QA_COMPLETION_PROJECTION_UNAVAILABLE");
    const candidate = await runtime.create(authority, f.workItemId, assessment);
    expect(candidate.expectedExternalVersion).toBe("provider-42");
    expect(candidate.bindingRef).toEqual({ id: pins.bindingRef.id, version: 1 });
    const publish = () => runtime.publish(authority, f.workItemId, candidate.candidateId, 1);
    const limited = {
      ...f,
      authorize: async (permission: string) => ({
        ...(await authority.authorize(permission)),
        ...(permission === "integration.use" ? { classificationCeiling: "PUBLIC" } : {}),
      }),
    };
    await expect(runtime.publish(limited, f.workItemId, candidate.candidateId, 1)).rejects.toThrow(
      "QA_COMPLETION_CLASSIFICATION_DENIED",
    );
    await f.source.query(
      "CREATE FUNCTION fail_completion_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_COMPLETION_OUTBOX_FAILURE'; END $$; CREATE TRIGGER fail_completion_outbox BEFORE INSERT ON command_outbox FOR EACH ROW EXECUTE FUNCTION fail_completion_outbox()",
    );
    await expect(publish()).rejects.toThrow("FORCED_COMPLETION_OUTBOX_FAILURE");
    expect(
      await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
        candidate.candidateId,
      ]),
    ).toEqual([{ state: "CANDIDATE" }]);
    expect(
      await f.source.query(
        "SELECT id FROM connector_commands WHERE payload->'metadata'->>'commandType'='qa.completion.done'",
      ),
    ).toHaveLength(0);
    await f.source.query("DROP TRIGGER fail_completion_outbox ON command_outbox");
    const results = await Promise.all([publish(), publish()]);
    expect(results.filter((value) => !value.replayed)).toHaveLength(1);
    expect(new Set(results.map((value) => value.commandId)).size).toBe(1);
    const command = (await new TypeOrmCommandRepository(f.source).get(
      f.workspaceId,
      f.projectId,
      results[0]!.commandId,
    ))!;
    expect(command).toMatchObject({
      status: "AWAITING_APPROVAL",
      outboxStatus: "HELD",
      recoveryPolicy: "LOOKUP_REQUIRED",
      payload: { expectedExternalVersion: "provider-42", completionSummary: candidate.summary },
    });
    await f.source.destroy();
    await f.source.initialize();
    const restarted = new DurableQaCompletionRuntime(f.source, dod, configuration);
    expect(
      await restarted.publish(authority, f.workItemId, candidate.candidateId, 1),
    ).toMatchObject({ commandId: command.id, replayed: true });
    const lead = await localQaTestRequest(f.source, "lead.alpha");
    const actor = (
      await authorizeQaApi(f.source, lead, f.workspaceId, f.projectId, "qa.completion.approve")
    ).actor;
    for (const table of ["role_assignments", "project_entitlements"])
      await f.source.query(
        `UPDATE ${table} SET permissions=permissions || '["approval.decide","connector.effect.approve"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
        [f.workspaceId, f.projectId, actor.principalId],
      );
    const approver = currentQaCommandAuthority(f.source, f, actor, "INTERNAL");
    await expect(approval.approve(authority, f.workItemId, command.approvalId!)).rejects.toThrow();
    await f.source.query(
      "UPDATE role_assignments SET role_key='qa-executor',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, actor.principalId],
    );
    await expect(approval.approve(approver, f.workItemId, command.approvalId!)).rejects.toThrow(
      "QA_COMPLETION_APPROVAL_DENIED",
    );
    await f.source.query(
      "UPDATE role_assignments SET role_key='qa-lead',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, actor.principalId],
    );
    await f.source.query("UPDATE operational_bindings SET freshness_state='STALE' WHERE id=$1", [
      operationalBindingId,
    ]);
    await expect(approval.approve(approver, f.workItemId, command.approvalId!)).rejects.toThrow(
      "QA_COMPLETION_PROJECTION_UNAVAILABLE",
    );
    await f.source.query("UPDATE operational_bindings SET freshness_state='CURRENT' WHERE id=$1", [
      operationalBindingId,
    ]);
    await f.source.query(
      "UPDATE connector_mapping_headers SET current_published_version=2 WHERE id=$1",
      [pins.mappingRef.id],
    );
    await expect(approval.approve(approver, f.workItemId, command.approvalId!)).rejects.toThrow(
      "QA_COMPLETION_CONFIGURATION_DENIED",
    );
    await f.source.query(
      "UPDATE connector_mapping_headers SET current_published_version=1 WHERE id=$1",
      [pins.mappingRef.id],
    );
    await f.source.query(
      "CREATE FUNCTION fail_completion_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_COMPLETION_RELEASE_FAILURE'; END $$; CREATE TRIGGER fail_completion_release BEFORE UPDATE ON command_outbox FOR EACH ROW EXECUTE FUNCTION fail_completion_release()",
    );
    await expect(approval.approve(approver, f.workItemId, command.approvalId!)).rejects.toThrow(
      "FORCED_COMPLETION_RELEASE_FAILURE",
    );
    expect(
      await f.source.query("SELECT decision_state FROM approvals WHERE id=$1", [
        command.approvalId,
      ]),
    ).toEqual([{ decision_state: "PENDING" }]);
    await f.source.query("DROP TRIGGER fail_completion_release ON command_outbox");
    const decisions = await Promise.allSettled([
      approval.approve(approver, f.workItemId, command.approvalId!),
      approval.approve(approver, f.workItemId, command.approvalId!),
    ]);
    expect(decisions.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const queued = (await new TypeOrmCommandRepository(f.source).get(
      f.workspaceId,
      f.projectId,
      command.id,
    ))!;
    expect(queued).toMatchObject({
      status: "QUEUED",
      effectAuthorizationStatus: "CONSUMED",
      attemptCount: 0,
    });
    expect(
      await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
        candidate.candidateId,
      ]),
    ).toEqual([{ state: "AUTHORIZED" }]);
    const delivery = new TypeOrmCommandDeliveryStore(f.source);
    const claimed = await claimReleasedCompletion(f, delivery, command.id);
    await delivery.acknowledgeEnqueued(claimed.outbox, new Date(), new Date(Date.now() + 30_000));
    const scope = { workspaceId: f.workspaceId, projectId: f.projectId, commandId: command.id };
    const dispatch = () => runtime.dispatch(authority, scope, new Date(), 30_000);
    await expect(runtime.dispatch(limited, scope, new Date(), 30_000)).rejects.toThrow(
      "QA_COMPLETION_CLASSIFICATION_DENIED",
    );
    await f.source.query(
      "UPDATE project_entitlements SET revoked_at=now() WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, us3Actor.principalId],
    );
    await expect(dispatch()).rejects.toThrow();
    await f.source.query(
      "UPDATE project_entitlements SET revoked_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, us3Actor.principalId],
    );
    await f.source.query(
      "CREATE FUNCTION fail_completion_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='ACKNOWLEDGED' THEN RAISE EXCEPTION 'FORCED_COMPLETION_DISPATCH_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_completion_dispatch BEFORE UPDATE ON command_outbox FOR EACH ROW EXECUTE FUNCTION fail_completion_dispatch()",
    );
    await expect(dispatch()).rejects.toThrow("FORCED_COMPLETION_DISPATCH_FAILURE");
    expect(
      await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
        candidate.candidateId,
      ]),
    ).toEqual([{ state: "AUTHORIZED" }]);
    expect(
      await f.source.query(
        "SELECT completion_in_flight_candidate_id FROM qa_request_extensions WHERE work_item_id=$1",
        [f.workItemId],
      ),
    ).toEqual([{ completion_in_flight_candidate_id: null }]);
    await f.source.query("DROP TRIGGER fail_completion_dispatch ON command_outbox");
    const dispatched = await dispatch();
    expect(dispatched).toMatchObject({ status: "DISPATCHED", attemptCount: 1 });
    expect(
      await f.source.query(
        "SELECT state,command_ref FROM qa_completion_candidates WHERE candidate_id=$1",
        [candidate.candidateId],
      ),
    ).toEqual([{ state: "DISPATCHED", command_ref: { id: command.id } }]);
    await expect(correctReview(f, candidate.summary.evidenceManifestRefs[0]!)).rejects.toThrow(
      "QA_COMPLETION_IN_FLIGHT",
    );
    expect(
      await f.source.query("SELECT version FROM qa_session_reviews WHERE work_item_id=$1", [
        f.workItemId,
      ]),
    ).toEqual([{ version: 1 }]);
    await expect(dispatch()).rejects.toThrow("COMMAND_OUTBOX_STATE_CONFLICT");
    const externalEntityId = (command.target as { externalEntityId: string }).externalEntityId;
    const result = {
      operation: "request.transition",
      normalizedStatus: "DONE",
      effectId: command.effectIdempotencyKey,
      externalEntityId,
      rawExternalState: "Closed",
      externalVersion: "provider-43",
      observedAt: new Date().toISOString(),
      completionSummaryReceipt: { id: "comment-42", contentHash: candidate.summary.contentHash },
    };
    const hook = createQaTypeOrmCompletionConfirmationHook();
    const effect: ConfirmedOperationalEffect = {
      ...scope,
      effectIdempotencyKey: command.effectIdempotencyKey,
      capabilityKey: "operational-work-item",
      capabilityVersion: "1.0.0",
      operation: "request.transition",
      source: command.source,
      bindingRef: command.bindingRef,
      profileRefs: [command.profileRef],
      correlationId: command.correlationId,
      causationId: command.causationId,
      result,
    };
    const confirm = (value = result) =>
      delivery.confirmWith(
        scope,
        value,
        new Date(),
        async (manager) => {
          await hook.apply(
            { ...effect, result: value },
            {
              native: manager,
              transactionId: command.id,
              contributionKey: hook.key,
              idempotencyKey: `${command.id}:confirmation:${hook.key}`,
            },
          );
        },
        {
          attemptCount: dispatched.attemptCount,
          leaseExpiresAt: dispatched.executionLeaseExpiresAt!,
        },
      );
    await expect(confirm({ ...result, externalEntityId: "foreign-request" })).rejects.toThrow(
      "QA_COMPLETION_CONFIRMATION_INVALID",
    );
    await expect(
      confirm({
        ...result,
        completionSummaryReceipt: {
          ...result.completionSummaryReceipt,
          contentHash: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).rejects.toThrow("QA_COMPLETION_CONFIRMATION_INVALID");
    await f.source.query(
      "CREATE FUNCTION fail_completion_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='SATISFIED' THEN RAISE EXCEPTION 'FORCED_COMPLETION_FINAL_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_completion_final BEFORE INSERT ON qa_dod_assessments FOR EACH ROW EXECUTE FUNCTION fail_completion_final()",
    );
    await expect(confirm()).rejects.toThrow("FORCED_COMPLETION_FINAL_FAILURE");
    expect(
      await f.source.query(
        "SELECT confirmation_id FROM qa_final_close_confirmations WHERE candidate_id=$1",
        [candidate.candidateId],
      ),
    ).toHaveLength(0);
    expect(
      await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
        candidate.candidateId,
      ]),
    ).toEqual([{ state: "DISPATCHED" }]);
    await f.source.query("DROP TRIGGER fail_completion_final ON qa_dod_assessments");
    expect(await confirm()).toMatchObject({ status: "CONFIRMED", attemptCount: 1 });
    const [satisfied] = (await f.source.query(
      "SELECT * FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND state='SATISFIED'",
      [f.workspaceId, f.projectId, f.workItemId],
    )) as Record<string, unknown>[];
    const [ready] = (await f.source.query(
      "SELECT inventory,rule_set_ref,risk_policy_ref,aggregate_input_hash FROM qa_dod_assessments WHERE assessment_id=$1",
      [assessment.id],
    )) as Record<string, unknown>[];
    expect(satisfied).toMatchObject(ready!);
    const rebuilt = buildQaDodAssessment({
      assessmentId: satisfied!.assessment_id,
      version: satisfied!.version,
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      workItemId: f.workItemId,
      state: "SATISFIED",
      blockerCodes: satisfied!.blocker_codes,
      warningCodes: satisfied!.warning_codes,
      inventory: satisfied!.inventory,
      aggregateInputHash: satisfied!.aggregate_input_hash,
      ruleSetRef: satisfied!.rule_set_ref,
      riskPolicyRef: satisfied!.risk_policy_ref,
      evaluatedBy: satisfied!.evaluated_by,
      evaluatedAt: (satisfied!.evaluated_at as Date).toISOString(),
      completionConfirmationRef: satisfied!.completion_confirmation_ref,
    } as Omit<QaDodAssessment, "contentHash">);
    expect(rebuilt.contentHash).toBe(satisfied!.content_hash);
    const replay = (value = result) =>
      f.source.transaction((manager) =>
        hook.apply(
          { ...effect, result: value },
          {
            native: manager,
            transactionId: command.id,
            contributionKey: hook.key,
            idempotencyKey: `${command.id}:confirmation:${hook.key}`,
          },
        ),
      );
    expect(await replay()).toMatchObject({ replayed: true });
    await expect(replay({ ...result, externalVersion: "provider-forged" })).rejects.toThrow(
      "QA_COMPLETION_CONFIRMATION_INVALID",
    );
    expect(
      await f.source.query(
        "SELECT confirmation_id FROM qa_final_close_confirmations WHERE candidate_id=$1",
        [candidate.candidateId],
      ),
    ).toHaveLength(1);
  }, 120_000);
  it("recovers a lost HTTP write response by read-back only, with one external effect after restart", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const pins = await seed008CompletionConfiguration(f);
    const dod = createLocalQaDodRuntime(f.source);
    const runtime = new DurableQaCompletionRuntime(
      f.source,
      dod,
      new PublishedQaCompletionConfiguration(f.source, [pins]),
    );
    const approval = new DurableQaCompletionApprovalRuntime(f.source, runtime);
    const assessment = await prepare008CompletionProof(
      f,
      new QaVerdictCompletionController(
        f.source,
        dod,
        runtime,
        approval,
        createLocalQaVerdictRuntime(f.source),
      ),
    );
    const bindingId = await observe008Completion(f, pins);
    const authority = currentQaCommandAuthority(f.source, f, us3Actor, "INTERNAL");
    const candidate = await runtime.create(authority, f.workItemId, assessment);
    const publication = await runtime.publish(authority, f.workItemId, candidate.candidateId, 1);
    const lead = await localQaTestRequest(f.source, "lead.alpha");
    const actor = (
      await authorizeQaApi(f.source, lead, f.workspaceId, f.projectId, "qa.completion.approve")
    ).actor;
    for (const table of ["role_assignments", "project_entitlements"])
      await f.source.query(
        `UPDATE ${table} SET permissions=permissions || '["approval.decide","connector.effect.approve"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
        [f.workspaceId, f.projectId, actor.principalId],
      );
    await approval.approve(
      currentQaCommandAuthority(f.source, f, actor, "INTERNAL"),
      f.workItemId,
      publication.approvalId,
    );
    const delivery = new TypeOrmCommandDeliveryStore(f.source);
    const claim = await claimReleasedCompletion(f, delivery, publication.commandId);
    await delivery.acknowledgeEnqueued(claim.outbox, new Date(), new Date(Date.now() + 30_000));
    const scope = {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      commandId: publication.commandId,
    };
    const [projection] = (await f.source.query(
      "SELECT authority_snapshot FROM operational_projection_revisions WHERE binding_id=$1 ORDER BY revision DESC LIMIT 1",
      [bindingId],
    )) as [{ authority_snapshot: CompleteOperationalObservation }];
    let now = new Date();
    const provider = await start008CompletionProvider((command) => {
      now = new Date();
      return {
        effectId: command.effectIdempotencyKey,
        completionSummaryReceipt: {
          id: "summary-http-1",
          contentHash: candidate.summary.contentHash,
        },
        observation: {
          ...projection.authority_snapshot,
          observationId: randomUUID(),
          source: "COMMAND_CONFIRMATION",
          externalRevisionToken: "provider-43",
          authorityFieldsHash: qaAggregateSnapshotHash({ status: "DONE" } as never),
          providerUpdatedAt: now.toISOString(),
          providerChangelogId: "43",
          observedAt: now.toISOString(),
          rawStatus: { id: "done-1", name: "Closed" },
          normalizedStatus: "DONE",
        },
      };
    });
    const purposes: string[] = [];
    const worker = () =>
      new DurableQaCompletionWorker(
        f.source,
        runtime,
        {
          initiator: () => authority,
          authorize: async (_command, purpose) => {
            purposes.push(purpose);
          },
          resolve: async () => provider.port,
        },
        () => now,
        1000,
      );
    try {
      expect(await worker().run(scope)).toMatchObject({ state: "LOOKUP_REQUIRED" });
      expect(provider.posts).toBe(1);
      await f.source.destroy();
      await f.source.initialize();
      await expect(worker().run(scope)).rejects.toThrow(
        "QA_COMPLETION_WORKER_INITIAL_ATTEMPT_REQUIRED",
      );
      const writesBeforeRecovery = purposes.filter((purpose) => purpose === "WRITE").length;
      const firstAttempt = (await new TypeOrmCommandRepository(f.source).get(
        scope.workspaceId,
        scope.projectId,
        scope.commandId,
      ))!;
      for (const visibility of ["UNKNOWN", "MULTIPLE", "ABSENT"] as const) {
        provider.visibility(visibility);
        now = new Date(now.getTime() + 1001);
        expect(await worker().recover(scope)).toMatchObject({
          state: "LOOKUP_REQUIRED",
          reason: visibility,
        });
        expect(provider.posts).toBe(1);
        expect(
          await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
            publication.commandId,
          ]),
        ).toEqual([{ state: "ACKNOWLEDGED" }]);
      }
      await expect(
        delivery.confirmWith(scope, {}, now, async () => {}, {
          attemptCount: firstAttempt.attemptCount,
          leaseExpiresAt: firstAttempt.executionLeaseExpiresAt!,
        }),
      ).rejects.toThrow("COMMAND_EXECUTION_FENCE_REJECTED");
      provider.visibility("FOUND");
      now = new Date(now.getTime() + 1001);
      await f.source.query(
        "CREATE FUNCTION fail_completion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='qa.completion.confirm' THEN RAISE EXCEPTION 'FORCED_COMPLETION_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_completion_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_completion_audit()",
      );
      expect(await worker().recover(scope)).toMatchObject({
        state: "LOOKUP_REQUIRED",
        reason: "UNAVAILABLE",
      });
      expect(
        await f.source.query(
          "SELECT confirmation_id FROM qa_final_close_confirmations WHERE candidate_id=$1",
          [candidate.candidateId],
        ),
      ).toHaveLength(0);
      expect(
        await f.source.query(
          "SELECT current_external_revision_token FROM operational_bindings WHERE id=$1",
          [bindingId],
        ),
      ).toEqual([{ current_external_revision_token: "provider-42" }]);
      await f.source.query("DROP TRIGGER fail_completion_audit ON audit_events");
      now = new Date(now.getTime() + 1001);
      expect(await worker().recover(scope)).toMatchObject({ state: "CONFIRMED" });
      expect(provider.posts).toBe(1);
      expect(provider.reads).toBe(5);
      expect(purposes.filter((purpose) => purpose === "WRITE")).toHaveLength(writesBeforeRecovery);
      expect(
        await f.source.query("SELECT normalized_status FROM work_items WHERE id=$1", [
          f.workItemId,
        ]),
      ).toEqual([{ normalized_status: "DONE" }]);
      expect(
        await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
          candidate.candidateId,
        ]),
      ).toEqual([{ state: "CONFIRMED" }]);
      expect(
        await f.source.query(
          "SELECT id FROM event_outbox WHERE event_type='qa.dod.satisfied' AND workspace_id=$1 AND project_id=$2",
          [f.workspaceId, f.projectId],
        ),
      ).toHaveLength(1);
      expect(
        await f.source.query(
          "SELECT id FROM audit_events WHERE action='qa.completion.confirm' AND workspace_id=$1 AND project_id=$2",
          [f.workspaceId, f.projectId],
        ),
      ).toHaveLength(1);
      expect(await worker().recover(scope)).toMatchObject({ state: "NOT_DUE" });
    } finally {
      await provider.stop();
    }
  }, 120_000);
  it("cancels an approved but undispatched closure when its signed verdict is superseded", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const pins = await seed008CompletionConfiguration(f);
    const dod = createLocalQaDodRuntime(f.source);
    const runtime = new DurableQaCompletionRuntime(
      f.source,
      dod,
      new PublishedQaCompletionConfiguration(f.source, [pins]),
    );
    const verdicts = createLocalQaVerdictRuntime(f.source);
    const approval = new DurableQaCompletionApprovalRuntime(f.source, runtime);
    const assessment = await prepare008CompletionProof(
      f,
      new QaVerdictCompletionController(f.source, dod, runtime, approval, verdicts),
    );
    await observe008Completion(f, pins);
    const authority = currentQaCommandAuthority(f.source, f, us3Actor, "INTERNAL");
    const candidate = await runtime.create(authority, f.workItemId, assessment);
    const published = await runtime.publish(authority, f.workItemId, candidate.candidateId, 1);
    const lead = await localQaTestRequest(f.source, "lead.alpha");
    const actor = (
      await authorizeQaApi(f.source, lead, f.workspaceId, f.projectId, "qa.completion.approve")
    ).actor;
    await approval.approve(
      currentQaCommandAuthority(f.source, f, actor, "INTERNAL"),
      f.workItemId,
      published.approvalId,
    );
    const successor = await verdicts.create(
      authority,
      f.workItemId,
      {
        verdict: "FAIL",
        residualRisk: { statement: "Updated human interpretation", classification: "LOW" },
        supersedesVerdictRef: candidate.verdictRef,
        revisionReason: "Corrected human verdict",
      },
      { verdictId: candidate.verdictRef.id, expectedVersion: 2 },
    );
    expect(
      await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
        candidate.candidateId,
      ]),
    ).toEqual([{ state: "INVALIDATED" }]);
    expect(
      await new TypeOrmCommandRepository(f.source).get(
        f.workspaceId,
        f.projectId,
        published.commandId,
      ),
    ).toMatchObject({
      status: "CANCELLED",
      outboxStatus: "DEAD",
      attemptCount: 0,
      effectAuthorizationStatus: "INVALIDATED",
    });
    expect(
      await f.source.query("SELECT effect_authorization_state FROM approvals WHERE id=$1", [
        published.approvalId,
      ]),
    ).toEqual([{ effect_authorization_state: "INVALIDATED" }]);
    await verdicts.sign(authority, f.workItemId, successor.verdictId, 1);
    const renewed = await dod.assess(authority, f.workItemId, {
      expectedAggregateSnapshotHash: successor.aggregateSnapshotHash,
      verdictRef: successor.ref,
    });
    expect(renewed.state).toBe("READY_TO_CLOSE");
    const next = await runtime.create(authority, f.workItemId, {
      id: renewed.assessmentId,
      version: renewed.version,
      contentHash: renewed.contentHash,
    });
    expect(next.candidateNumber).toBe(2);
    expect(next.summary.verdict).toBe("FAIL");
  }, 120_000);
  it.each([false, true])(
    "atomically cancels closure and preserves DoD provenance on review correction (approved=%s)",
    async (approved) => {
      const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
      const pins = await seed008CompletionConfiguration(f);
      const dod = createLocalQaDodRuntime(f.source);
      const runtime = new DurableQaCompletionRuntime(
        f.source,
        dod,
        new PublishedQaCompletionConfiguration(f.source, [pins]),
      );
      const approval = new DurableQaCompletionApprovalRuntime(f.source, runtime);
      const assessment = await prepare008CompletionProof(
        f,
        new QaVerdictCompletionController(
          f.source,
          dod,
          runtime,
          approval,
          createLocalQaVerdictRuntime(f.source),
        ),
      );
      await observe008Completion(f, pins);
      const authority = currentQaCommandAuthority(f.source, f, us3Actor, "INTERNAL");
      const candidate = await runtime.create(authority, f.workItemId, assessment);
      const published = await runtime.publish(authority, f.workItemId, candidate.candidateId, 1);
      if (approved) {
        const lead = await localQaTestRequest(f.source, "lead.alpha");
        const actor = (
          await authorizeQaApi(f.source, lead, f.workspaceId, f.projectId, "qa.completion.approve")
        ).actor;
        await approval.approve(
          currentQaCommandAuthority(f.source, f, actor, "INTERNAL"),
          f.workItemId,
          published.approvalId,
        );
      }
      const correct = () => correctReview(f, candidate.summary.evidenceManifestRefs[0]!);
      await f.source.query("UPDATE work_items SET classification_key='CONFIDENTIAL' WHERE id=$1", [
        f.workItemId,
      ]);
      await expect(correct()).rejects.toThrow("QA_SESSION_REVIEW_CLASSIFICATION_DENIED");
      await f.source.query("UPDATE work_items SET classification_key='INTERNAL' WHERE id=$1", [
        f.workItemId,
      ]);
      await f.source.query(
        "CREATE FUNCTION fail_review_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version>1 THEN RAISE EXCEPTION 'FORCED_REVIEW_CORRECTION_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_review_correction BEFORE INSERT ON qa_session_reviews FOR EACH ROW EXECUTE FUNCTION fail_review_correction()",
      );
      await expect(correct()).rejects.toThrow("FORCED_REVIEW_CORRECTION_FAILURE");
      expect(
        await new TypeOrmCommandRepository(f.source).get(
          f.workspaceId,
          f.projectId,
          published.commandId,
        ),
      ).toMatchObject({ status: approved ? "QUEUED" : "AWAITING_APPROVAL" });
      expect(
        await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
          candidate.candidateId,
        ]),
      ).toEqual([{ state: approved ? "AUTHORIZED" : "AWAITING_APPROVAL" }]);
      await f.source.query("DROP TRIGGER fail_review_correction ON qa_session_reviews");
      await correct();
      expect(
        await new TypeOrmCommandRepository(f.source).get(
          f.workspaceId,
          f.projectId,
          published.commandId,
        ),
      ).toMatchObject({
        status: "CANCELLED",
        outboxStatus: "DEAD",
        attemptCount: 0,
        effectAuthorizationStatus: "INVALIDATED",
      });
      expect(
        await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
          published.commandId,
        ]),
      ).toEqual([{ state: "DEAD" }]);
      expect(
        await f.source.query("SELECT state FROM qa_completion_candidates WHERE candidate_id=$1", [
          candidate.candidateId,
        ]),
      ).toEqual([{ state: "INVALIDATED" }]);
      expect(
        await f.source.query(
          "SELECT decision_state,effect_authorization_state FROM approvals WHERE id=$1",
          [published.approvalId],
        ),
      ).toEqual([
        {
          decision_state: approved ? "APPROVED" : "CANCELLED",
          effect_authorization_state: approved ? "INVALIDATED" : "NOT_AUTHORIZED",
        },
      ]);
      const [ready] = (await f.source.query(
        "SELECT inventory,rule_set_ref,risk_policy_ref,aggregate_input_hash FROM qa_dod_assessments WHERE assessment_id=$1",
        [assessment.id],
      )) as Record<string, unknown>[];
      const [blocked] = (await f.source.query(
        "SELECT d.* FROM qa_request_extensions e JOIN qa_dod_assessments d ON d.assessment_id=e.latest_dod_assessment_id WHERE e.work_item_id=$1",
        [f.workItemId],
      )) as Record<string, unknown>[];
      expect(blocked).toMatchObject({
        ...ready,
        state: "BLOCKED",
        blocker_codes: ["AGGREGATE_CHANGED"],
      });
      expect(
        await f.source.query(
          "SELECT version FROM qa_session_reviews WHERE work_item_id=$1 ORDER BY version",
          [f.workItemId],
        ),
      ).toEqual([{ version: 1 }, { version: 2 }]);
      expect(
        await f.source.query(
          "SELECT reason_code FROM audit_events WHERE action='qa.completion.invalidate' AND attributes->'values'->>'candidateId'=$1",
          [candidate.candidateId],
        ),
      ).toEqual([{ reason_code: "AGGREGATE_CHANGED" }]);
    },
    120_000,
  );
});

function correctReview(
  f: Us3DatabaseFixture,
  previous: { id: string; version: number; contentHash: `sha256:${string}` },
) {
  return new QaSessionReviewController(f.source).publish(
    f.request as never,
    f.workspaceId,
    f.projectId,
    f.workItemId,
    f.sessionId,
    'W/"1"',
    {
      reviewKind: "SUBSTANTIVE_CORRECTION",
      sessionOutcome: "PASSED",
      outcomeSummary: "Corrected interpretation of existing evidence",
      expectedExecutionSetHash: qaAggregateSnapshotHash({} as never),
      expectedFlakyDispositionBases: [],
      previousManifestRevisionRef: previous,
      correctionReason: "Clarify the human review",
    },
    f.response,
  );
}
