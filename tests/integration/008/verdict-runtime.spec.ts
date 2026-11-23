import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { authorizeQaApi } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { QaSessionReviewController } from "../../../apps/api/src/extensions/qa-session-review.controller.ts";
import {
  createLocalQaDodPolicy,
  createLocalQaVerdictRuntime,
} from "../../../apps/api/src/local/local-qa-dod-runtime.ts";
import type { QaExactReference } from "../../../packages/competency-qa/src/node.ts";
import { DurableQaDodRuntime } from "../../../packages/runtime-composition/src/pilot/dod-runtime.ts";
import { currentQaCommandAuthority } from "../../../packages/runtime-composition/src/pilot/qa-command-authority.ts";
import { DurableQaVerdictRuntime } from "../../../packages/runtime-composition/src/pilot/verdict-runtime.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";
import { prepare008VerdictInventory } from "../../support/008-completion.ts";
import { localQaTestRequest } from "../../support/008-qa-request.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let fixture: Us3DatabaseFixture | undefined;
afterEach(async () => {
  await stopUs3DatabaseFixture(fixture);
  fixture = undefined;
});
const judgment = {
  verdict: "PASS" as const,
  residualRisk: { statement: "Human reviewed residual risk", classification: "LOW" as const },
};
describe.each(POSTGRES_TEST_IMAGES)("server-owned verdict %s", (postgresImage) => {
  it("ignores forged inventory and identity, enforces current role/classification and atomically signs once", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const { aggregate, plan } = await prepare008VerdictInventory(f);
    const runtime = createLocalQaVerdictRuntime(f.source);
    const authority = currentQaCommandAuthority(f.source, f, us3Actor, "INTERNAL");
    const supplied = {
      ...judgment,
      version: 99,
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      workItemId: randomUUID(),
      verdictId: "forged-id",
      createdBy: { kind: "SERVICE", principalId: "forged" },
      effectiveRisk: "CRITICAL",
      sessionReviewRefs: [],
      evidenceManifestRefs: [],
      findingOutcomeRefs: [],
      requiredSessionPlanRef: { id: "forged", version: 1, contentHash: "fake" },
      expectedAggregateSnapshotHash: aggregate,
    };
    const verdict = await runtime.create(authority, f.workItemId, supplied);
    expect(verdict).toMatchObject({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      workItemId: f.workItemId,
      version: 1,
      createdBy: us3Actor,
      effectiveRisk: "ORDINARY",
      requiredSessionPlanRef: plan,
    });
    expect(verdict.verdictId).not.toBe("forged-id");
    expect(verdict.sessionReviewRefs).toHaveLength(1);
    expect(verdict.evidenceManifestRefs).toHaveLength(1);
    const sign = () => runtime.sign(authority, f.workItemId, verdict.verdictId, 1);
    await f.source.query(
      "UPDATE role_assignments SET role_key='qa-lead',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, us3Actor.principalId],
    );
    await expect(sign()).rejects.toThrow("QA_VERDICT_PRIMARY_NOT_AUTHORIZED");
    await f.source.query(
      "UPDATE role_assignments SET role_key='qa-executor',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, us3Actor.principalId],
    );
    await f.source.query("UPDATE work_items SET classification_key='RESTRICTED' WHERE id=$1", [
      f.workItemId,
    ]);
    await expect(sign()).rejects.toThrow("QA_VERDICT_CLASSIFICATION_DENIED");
    await f.source.query("UPDATE work_items SET classification_key='INTERNAL' WHERE id=$1", [
      f.workItemId,
    ]);
    await f.source.query(
      "CREATE FUNCTION fail_verdict_signature() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_VERDICT_SIGNATURE_FAILURE'; END $$; CREATE TRIGGER fail_verdict_signature BEFORE UPDATE ON qa_verdicts FOR EACH ROW EXECUTE FUNCTION fail_verdict_signature()",
    );
    await expect(sign()).rejects.toThrow("FORCED_VERDICT_SIGNATURE_FAILURE");
    expect(
      await f.source.query("SELECT signature_id FROM qa_verdict_signatures WHERE verdict_id=$1", [
        verdict.verdictId,
      ]),
    ).toHaveLength(0);
    await f.source.query("DROP TRIGGER fail_verdict_signature ON qa_verdicts");
    const signed = await Promise.allSettled([sign(), sign()]);
    expect(signed.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(
      await f.source.query("SELECT state,resource_version FROM qa_verdicts WHERE verdict_id=$1", [
        verdict.verdictId,
      ]),
    ).toEqual([{ state: "SIGNED", resource_version: "2" }]);
    const successor = await runtime.create(
      authority,
      f.workItemId,
      {
        ...judgment,
        verdict: "FAIL",
        supersedesVerdictRef: verdict.ref,
        revisionReason: "New human judgment",
      },
      { verdictId: verdict.verdictId, expectedVersion: 2 },
    );
    expect(successor.version).toBe(2);
    expect(
      await f.source.query("SELECT state FROM qa_verdicts WHERE verdict_id=$1", [
        verdict.verdictId,
      ]),
    ).toEqual([{ state: "SUPERSEDED" }]);
    await expect(
      runtime.create(
        authority,
        f.workItemId,
        { ...judgment, supersedesVerdictRef: verdict.ref, revisionReason: "Stale replacement" },
        { verdictId: verdict.verdictId, expectedVersion: 2 },
      ),
    ).rejects.toThrow("QA_VERDICT_CURRENT_INPUTS_REQUIRED");
  }, 120_000);
  it("requires lead co-sign for the actual request risk and rejects a corrected review or policy drift before signing", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage, requestRisk: "HIGH" }));
    const { aggregate, execution } = await prepare008VerdictInventory(f);
    const authority = currentQaCommandAuthority(f.source, f, us3Actor, "INTERNAL");
    const policy = createLocalQaDodPolicy();
    const runtime = new DurableQaVerdictRuntime(f.source, policy);
    const verdict = await runtime.create(authority, f.workItemId, {
      ...judgment,
      expectedAggregateSnapshotHash: aggregate,
    });
    expect(verdict.effectiveRisk).toBe("HIGH");
    const critical = new DurableQaVerdictRuntime(f.source, {
      load: async (...args) => ({
        ...(await policy.load(...args)),
        minimumEffectiveRisk: "CRITICAL",
      }),
    });
    await expect(critical.sign(authority, f.workItemId, verdict.verdictId, 1)).rejects.toThrow(
      "QA_VERDICT_CURRENT_INPUTS_REQUIRED",
    );
    await f.source.destroy();
    await f.source.initialize();
    expect((await runtime.sign(authority, f.workItemId, verdict.verdictId, 1)).verdict.state).toBe(
      "PARTIALLY_SIGNED",
    );
    const dod = await new DurableQaDodRuntime(f.source, policy).assess(authority, f.workItemId, {
      expectedAggregateSnapshotHash: aggregate,
      verdictRef: verdict.ref,
    });
    expect(dod.blockerCodes).toContain("VERDICT_UNSIGNED");
    const requestCosign = () =>
      runtime.requestCosign(
        authority,
        f.workItemId,
        verdict.verdictId,
        2,
        "Independent risk review",
      );
    await f.source.query(
      "CREATE FUNCTION fail_cosign_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_COSIGN_APPROVAL_FAILURE'; END $$; CREATE TRIGGER fail_cosign_approval BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION fail_cosign_approval()",
    );
    await expect(requestCosign()).rejects.toThrow("FORCED_COSIGN_APPROVAL_FAILURE");
    expect(
      await f.source.query("SELECT id FROM platform_actions WHERE action_kind='qa.verdict.cosign'"),
    ).toHaveLength(0);
    await f.source.query("DROP TRIGGER fail_cosign_approval ON approvals");
    const requests = await Promise.all([requestCosign(), requestCosign()]);
    expect(new Set(requests.map((value) => value.approvalId)).size).toBe(1);
    expect(requests.filter((value) => !value.replayed)).toHaveLength(1);
    const pending = requests[0]!;
    const leadRequest = await localQaTestRequest(f.source, "lead.alpha");
    const actor = (
      await authorizeQaApi(f.source, leadRequest, f.workspaceId, f.projectId, "qa.verdict.cosign")
    ).actor;
    for (const table of ["role_assignments", "project_entitlements"])
      await f.source.query(
        `UPDATE ${table} SET permissions=permissions || '["approval.decide"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
        [f.workspaceId, f.projectId, actor.principalId],
      );
    const approver = currentQaCommandAuthority(f.source, f, actor, "INTERNAL");
    const approve = () =>
      runtime.approveCosign(approver, f.workItemId, verdict.verdictId, pending.approvalId);
    await expect(
      runtime.approveCosign(authority, f.workItemId, verdict.verdictId, pending.approvalId),
    ).rejects.toThrow();
    await expect(
      runtime.approveCosign(approver, randomUUID(), verdict.verdictId, pending.approvalId),
    ).rejects.toThrow("QA_VERDICT_COSIGN_DENIED");
    await f.source.query("UPDATE approvals SET expires_at=now()-interval '1 second' WHERE id=$1", [
      pending.approvalId,
    ]);
    await expect(approve()).rejects.toThrow("QA_VERDICT_COSIGN_DENIED");
    await f.source.query(
      "UPDATE approvals SET expires_at=(subject->>'expiresAt')::timestamptz WHERE id=$1",
      [pending.approvalId],
    );
    await f.source.query(
      "UPDATE role_assignments SET role_key='qa-executor',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, actor.principalId],
    );
    await expect(approve()).rejects.toThrow("QA_VERDICT_COSIGN_DENIED");
    await f.source.query(
      "UPDATE role_assignments SET role_key='qa-lead',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
      [f.workspaceId, f.projectId, actor.principalId],
    );
    await f.source.query(
      "CREATE FUNCTION fail_cosign_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='qa.verdict.sign' THEN RAISE EXCEPTION 'FORCED_COSIGN_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_cosign_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_cosign_audit()",
    );
    await expect(approve()).rejects.toThrow("FORCED_COSIGN_AUDIT_FAILURE");
    expect(
      await f.source.query("SELECT signature_id FROM qa_verdict_signatures WHERE verdict_id=$1", [
        verdict.verdictId,
      ]),
    ).toHaveLength(1);
    expect(
      await f.source.query("SELECT decision_state FROM approvals WHERE id=$1", [
        pending.approvalId,
      ]),
    ).toEqual([{ decision_state: "PENDING" }]);
    await f.source.query("DROP TRIGGER fail_cosign_audit ON audit_events");
    const decisions = await Promise.allSettled([approve(), approve()]);
    expect(decisions.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(
      await f.source.query("SELECT state FROM qa_verdicts WHERE verdict_id=$1", [
        verdict.verdictId,
      ]),
    ).toEqual([{ state: "SIGNED" }]);
    expect(
      await f.source.query("SELECT state FROM platform_actions WHERE id=$1", [pending.actionId]),
    ).toEqual([{ state: "COMPLETED" }]);
    expect(
      await f.source.query(
        "SELECT decision_state,effect_authorization_state FROM approvals WHERE id=$1",
        [pending.approvalId],
      ),
    ).toEqual([{ decision_state: "APPROVED", effect_authorization_state: "CONSUMED" }]);
    expect(
      (
        await new DurableQaDodRuntime(f.source, policy).assess(authority, f.workItemId, {
          expectedAggregateSnapshotHash: aggregate,
          verdictRef: verdict.ref,
        })
      ).state,
    ).toBe("READY_TO_CLOSE");
    await new QaSessionReviewController(f.source).publish(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      f.sessionId,
      'W/"1"',
      {
        reviewKind: "SUBSTANTIVE_CORRECTION",
        sessionOutcome: "PASSED",
        outcomeSummary: "Changed review evidence",
        expectedExecutionSetHash: execution.executionSetHash,
        expectedFlakyDispositionBases: [],
        previousManifestRevisionRef: verdict.evidenceManifestRefs[0] as QaExactReference,
        correctionReason: "Renewed review",
      },
      f.response,
    );
    expect(
      (
        await new DurableQaDodRuntime(f.source, policy).assess(authority, f.workItemId, {
          expectedAggregateSnapshotHash: aggregate,
          verdictRef: verdict.ref,
        })
      ).blockerCodes,
    ).toContain("VERDICT_STALE");
  }, 120_000);
});
