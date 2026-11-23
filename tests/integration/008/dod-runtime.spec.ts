import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { QaSessionReviewController } from "../../../apps/api/src/extensions/qa-session-review.controller.ts";
import { QaVerdictCompletionController } from "../../../apps/api/src/extensions/qa-verdict-completion.controller.ts";
import { createLocalQaCompletionRuntime } from "../../../apps/api/src/local/local-qa-completion-runtime.ts";
import {
  publishQaRiskReviewPolicy,
  qaAggregateSnapshotHash,
  type QaRequestExtension,
} from "../../../packages/competency-qa/src/node.ts";
import {
  compiledQaDodPolicyRefs,
  PublishedQaDodPolicy,
} from "../../../packages/runtime-composition/src/pilot/dod-policy.ts";
import {
  DurableQaDodRuntime,
  type QaDodPolicyPort,
} from "../../../packages/runtime-composition/src/pilot/dod-runtime.ts";
import { DurableQaVerdictRuntime } from "../../../packages/runtime-composition/src/pilot/verdict-runtime.ts";
import {
  executeUs3CleanPass,
  reviewUs3CleanPass,
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
  us3Digest,
} from "../../support/002-us3-database.ts";
import { create008FrozenProductFinding } from "../../support/008-frozen-finding.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let fixture: Us3DatabaseFixture | undefined;
afterEach(async () => {
  await stopUs3DatabaseFixture(fixture);
  fixture = undefined;
});
const policy: QaDodPolicyPort = {
  load: async (_manager, _scope, extension) => ({
    rules: { id: "qa.dod", version: 1, contentHash: extension.dodRuleSetRef.contentHash },
    riskPolicyRef: extension.riskReviewPolicyRef,
    evidencePolicyRef: extension.evidencePolicyRef,
    minimumEffectiveRisk: "ORDINARY",
    maximumClassificationKey: "INTERNAL",
  }),
};

async function verdictInput(f: Us3DatabaseFixture) {
  const [plan] = await f.source.query(
    "SELECT current_version_id,current_version,current_content_hash FROM qa_required_session_plans WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
    [f.workspaceId, f.projectId, f.workItemId],
  );
  await f.source.query(
    "UPDATE qa_request_extensions SET current_required_session_plan_version_id=$1,current_required_session_plan_content_hash=$2 WHERE workspace_id=$3 AND project_id=$4 AND work_item_id=$5",
    [plan.current_version_id, plan.current_content_hash, f.workspaceId, f.projectId, f.workItemId],
  );
  const reviews = await f.source.query(
    'SELECT session_review_id AS id,version,content_hash AS "contentHash" FROM qa_session_reviews WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3',
    [f.workspaceId, f.projectId, f.workItemId],
  );
  const manifests = await f.source.query(
    'SELECT manifest_revision_id AS id,version,content_hash AS "contentHash" FROM qa_evidence_manifest_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3',
    [f.workspaceId, f.projectId, f.workItemId],
  );
  const findings = await f.source.query(
    "SELECT finding_review_revision_id AS id,version,content_hash AS \"contentHash\" FROM qa_finding_review_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND stage='FROZEN'",
    [f.workspaceId, f.projectId, f.workItemId],
  );
  return {
    version: 1,
    verdict: "PASS" as const,
    residualRisk: { statement: "Reviewed remaining risks", classification: "LOW" as const },
    effectiveRisk: "ORDINARY" as const,
    requiredSessionPlanRef: {
      id: plan.current_version_id,
      version: plan.current_version,
      contentHash: plan.current_content_hash,
    },
    sessionReviewRefs: reviews,
    evidenceManifestRefs: manifests,
    findingOutcomeRefs: findings,
    dodRuleSetRef: { id: "qa.dod", version: 1, contentHash: us3Digest("dod") },
    riskPolicyRef: { id: "risk", version: 1, contentHash: us3Digest("risk") },
  };
}
async function prepare(f: Us3DatabaseFixture) {
  await f.source.query(
    "UPDATE qa_request_extensions SET adjudicative_aggregate_hash=$1 WHERE workspace_id=$2 AND project_id=$3 AND work_item_id=$4",
    [
      qaAggregateSnapshotHash({ workItemId: f.workItemId } as never),
      f.workspaceId,
      f.projectId,
      f.workItemId,
    ],
  );
  const runtime = new DurableQaDodRuntime(f.source, policy);
  const controller = new QaVerdictCompletionController(
    f.source,
    runtime,
    createLocalQaCompletionRuntime(f.source, runtime),
    {} as never,
    new DurableQaVerdictRuntime(f.source, policy),
  );
  const body = await verdictInput(f);
  const [extension] = await f.source.query(
    "SELECT content,adjudicative_aggregate_hash FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
    [f.workspaceId, f.projectId, f.workItemId],
  );
  body.riskPolicyRef = extension.content.riskReviewPolicyRef;
  const verdict = await controller.createVerdict(
    f.request as never,
    f.workspaceId,
    f.projectId,
    f.workItemId,
    body,
    f.response,
  );
  const input = {
    expectedAggregateSnapshotHash: extension.adjudicative_aggregate_hash,
    verdictRef: {
      id: verdict.verdictId,
      version: verdict.version,
      contentHash: verdict.contentHash,
    },
  };
  return { runtime, controller, verdict, input };
}

describe.each(POSTGRES_TEST_IMAGES)("durable DoD %s", (postgresImage) => {
  it("uses persisted signatures and inventory; serializes assessments, rolls back failures and denies scope/classification", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const execution = await executeUs3CleanPass(f);
    await reviewUs3CleanPass(f, execution.executionSetHash);
    const { controller, verdict, input } = await prepare(f);
    const assess = (body: unknown = input) =>
      controller.assessDod(
        f.request as never,
        f.workspaceId,
        f.projectId,
        f.workItemId,
        body as never,
      );
    const unsigned = await assess({
      ...input,
      verdict: {
        ...input.verdictRef,
        state: "SIGNED",
        matchesAggregate: true,
        residualRiskPresent: true,
      },
      evidencePolicySatisfied: true,
    });
    expect(unsigned.blockerCodes).toContain("VERDICT_UNSIGNED");
    await controller.signVerdict(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      verdict.verdictId,
      'W/"1"',
      f.response,
    );
    const ready = await assess();
    expect(ready.state).toBe("READY_TO_CLOSE");
    expect(ready.inventory.sessionReviewRefs).toHaveLength(1);
    expect(ready.inventory.evidenceManifestRefs).toHaveLength(1);
    const candidateBody = {
      readyToCloseDodRef: {
        id: ready.assessmentId,
        version: ready.version,
        contentHash: ready.contentHash,
      },
      verdict: "FAIL",
      residualRisk: "Forged request text",
      evidenceManifestRefs: [],
      defectLinkOrDispositionRefs: [],
    };
    const candidate = await controller.createCandidate(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      candidateBody as never,
      f.response,
    );
    expect(candidate.summary.verdict).toBe("PASS");
    expect(candidate.summary.residualRisk).toBe("Reviewed remaining risks");
    expect(candidate.summary.evidenceManifestRefs).toHaveLength(1);
    expect(candidate.summary.defectLinkOrDispositionRefs).toEqual([]);
    expect(candidate.verdictRef).toEqual(input.verdictRef);
    const elevatedDod = new DurableQaDodRuntime(f.source, {
      load: async (...args) => ({ ...(await policy.load(...args)), minimumEffectiveRisk: "HIGH" }),
    });
    const elevated = new QaVerdictCompletionController(
      f.source,
      elevatedDod,
      createLocalQaCompletionRuntime(f.source, elevatedDod),
      {} as never,
      new DurableQaVerdictRuntime(f.source, policy),
    );
    expect(
      (
        await elevated.assessDod(
          f.request as never,
          f.workspaceId,
          f.projectId,
          f.workItemId,
          input,
        )
      ).blockerCodes,
    ).toContain("VERDICT_UNSIGNED");
    expect(
      (
        await assess({
          ...input,
          expectedAggregateSnapshotHash: qaAggregateSnapshotHash("stale" as never),
        })
      ).blockerCodes,
    ).toContain("AGGREGATE_CHANGED");
    await expect(
      assess({
        ...input,
        verdictRef: {
          ...input.verdictRef,
          contentHash: qaAggregateSnapshotHash("forged" as never),
        },
      }),
    ).rejects.toThrow("QA_DOD_VERDICT_NOT_FOUND");
    await expect(
      controller.assessDod(f.request as never, f.workspaceId, f.projectId, randomUUID(), input),
    ).rejects.toThrow("QA_DOD_REQUEST_NOT_FOUND");
    const parallel = await Promise.all([assess(), assess()]);
    expect(new Set(parallel.map((value) => value.version)).size).toBe(2);
    await f.source.query(
      "CREATE FUNCTION fail_dod_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture pointer failure'; END $$; CREATE TRIGGER fail_dod_pointer BEFORE UPDATE ON qa_request_extensions FOR EACH ROW EXECUTE FUNCTION fail_dod_pointer()",
    );
    const [before] = await f.source.query("SELECT count(*) AS count FROM qa_dod_assessments");
    await expect(assess()).rejects.toThrow();
    expect(
      (await f.source.query("SELECT count(*) AS count FROM qa_dod_assessments"))[0].count,
    ).toBe(before.count);
    await f.source.query(
      "DROP TRIGGER fail_dod_pointer ON qa_request_extensions; DROP FUNCTION fail_dod_pointer()",
    );
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
        outcomeSummary: "Corrected interpretation after renewed human review",
        expectedExecutionSetHash: execution.executionSetHash,
        expectedFlakyDispositionBases: [],
        previousManifestRevisionRef: ready.inventory.evidenceManifestRefs[0]!,
        correctionReason: "Correct the substantive review statement",
      },
      f.response,
    );
    const latestReady = [...parallel].sort((a, b) => b.version - a.version)[0]!;
    await expect(
      controller.createCandidate(
        f.request as never,
        f.workspaceId,
        f.projectId,
        f.workItemId,
        {
          ...candidateBody,
          readyToCloseDodRef: {
            id: latestReady.assessmentId,
            version: latestReady.version,
            contentHash: latestReady.contentHash,
          },
        } as never,
        f.response,
      ),
    ).rejects.toThrow("QA_DOD_ASSESSMENT_NOT_CURRENT");
    expect((await assess()).blockerCodes).toContain("VERDICT_STALE");
    const restartedDod = new DurableQaDodRuntime(f.source, policy);
    const restarted = new QaVerdictCompletionController(
      f.source,
      restartedDod,
      createLocalQaCompletionRuntime(f.source, restartedDod),
      {} as never,
      new DurableQaVerdictRuntime(f.source, policy),
    );
    expect(
      (
        await restarted.assessDod(
          f.request as never,
          f.workspaceId,
          f.projectId,
          f.workItemId,
          input,
        )
      ).blockerCodes,
    ).toContain("VERDICT_STALE");
    await f.source.query("UPDATE work_items SET classification_key='CONFIDENTIAL' WHERE id=$1", [
      f.workItemId,
    ]);
    await expect(assess()).rejects.toThrow("QA_DOD_CLASSIFICATION_DENIED");
    await expect(
      controller.detail(f.request as never, f.workspaceId, f.projectId, f.workItemId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.candidate(
        f.request as never,
        f.workspaceId,
        f.projectId,
        f.workItemId,
        candidate.candidateId,
        f.response,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.finalClose(
        f.request as never,
        f.workspaceId,
        f.projectId,
        f.workItemId,
        candidate.candidateId,
      ),
    ).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it("cannot omit a pending defect or expired artifact by supplying successful client facts", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    await create008FrozenProductFinding(f);
    const { controller, verdict, input } = await prepare(f);
    await controller.signVerdict(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      verdict.verdictId,
      'W/"1"',
      f.response,
    );
    const assess = () =>
      controller.assessDod(f.request as never, f.workspaceId, f.projectId, f.workItemId, {
        ...input,
        findings: [],
        sessionReviews: [],
        evidencePolicySatisfied: true,
      } as never);
    expect((await assess()).blockerCodes).toContain("DRAFT_PUBLICATION_UNRESOLVED");
    await f.source.query(
      "UPDATE artifact_references SET availability='EXPIRED' WHERE workspace_id=$1 AND project_id=$2",
      [f.workspaceId, f.projectId],
    );
    const blocked = await assess();
    expect(blocked.blockerCodes).toEqual(
      expect.arrayContaining(["DRAFT_PUBLICATION_UNRESOLVED", "NEGATIVE_EVIDENCE_INCOMPLETE"]),
    );
  }, 120_000);

  it("resolves exact current published policy heads and refuses unsupported or drifted configuration", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const [stored] = await f.source.query(
      "SELECT content FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
      [f.workspaceId, f.projectId, f.workItemId],
    );
    const extension = stored.content as QaRequestExtension;
    const [existing] = await f.source.query(
      "SELECT content FROM qa_project_context_versions WHERE workspace_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1",
      [f.workspaceId, f.projectId],
    );
    const risk = publishQaRiskReviewPolicy({
      policyId: randomUUID(),
      version: 1,
      scope: f,
      actor: us3Actor,
      publishedAt: new Date().toISOString(),
    });
    const riskRef = { id: risk.policyId, version: risk.version, contentHash: risk.contentHash };
    const contextBody = {
      ...existing.content,
      contextId: randomUUID(),
      riskReviewPolicyRef: riskRef,
      dodRuleSetRef: compiledQaDodPolicyRefs.rules,
      evidencePolicyRef: compiledQaDodPolicyRefs.evidence,
      projectRisk: "HIGH",
    };
    delete contextBody.contentHash;
    const context = { ...contextBody, contentHash: qaAggregateSnapshotHash(contextBody as never) };
    const contextRef = {
      id: context.contextId,
      version: context.version,
      contentHash: context.contentHash,
    };
    for (const [header, versions, id, value] of [
      ["qa_risk_review_policies", "qa_risk_review_policy_versions", risk.policyId, risk],
      ["qa_project_contexts", "qa_project_context_versions", context.contextId, context],
    ] as const) {
      const versionId = randomUUID();
      await f.source.query(
        `INSERT INTO ${header}(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1)`,
        [id, f.workspaceId, f.projectId],
      );
      await f.source.query(
        `INSERT INTO ${versions}(id,workspace_id,project_id,header_id,version,content_hash,content,published_by,published_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,clock_timestamp())`,
        [versionId, f.workspaceId, f.projectId, id, value.contentHash, value, us3Actor],
      );
      await f.source.query(
        `UPDATE ${header} SET current_published_version_id=$1,current_published_version=1,current_published_content_hash=$2 WHERE id=$3`,
        [versionId, value.contentHash, id],
      );
    }
    const pins = {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      contextRef,
      riskPolicyRef: riskRef,
    };
    const published = new PublishedQaDodPolicy([pins]);
    const current = {
      ...extension,
      projectContextRef: contextRef,
      riskReviewPolicyRef: riskRef,
      dodRuleSetRef: compiledQaDodPolicyRefs.rules,
      evidencePolicyRef: compiledQaDodPolicyRefs.evidence,
    };
    expect(
      (await f.source.transaction((manager) => published.load(manager, f, current)))
        .minimumEffectiveRisk,
    ).toBe("HIGH");
    await expect(
      f.source.transaction((manager) =>
        published.load(manager, f, {
          ...current,
          dodRuleSetRef: {
            ...current.dodRuleSetRef,
            contentHash: qaAggregateSnapshotHash("wrong dialect" as never),
          },
        }),
      ),
    ).rejects.toThrow("QA_DOD_POLICY_UNSUPPORTED");
    for (const table of ["qa_project_contexts", "qa_risk_review_policies"]) {
      await f.source
        .transaction(async (manager) => {
          const id = table === "qa_project_contexts" ? contextRef.id : riskRef.id;
          await manager.query(`UPDATE ${table} SET current_published_version_id=NULL WHERE id=$1`, [
            id,
          ]);
          await expect(published.load(manager, f, current)).rejects.toThrow(
            "QA_DOD_POLICY_NOT_CURRENT",
          );
          // Roll back only this deliberate drift; the next assertion starts from the valid heads.
          throw new Error("FIXTURE_ROLLBACK");
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error) || error.message !== "FIXTURE_ROLLBACK") throw error;
        });
    }
  }, 120_000);

  it("does not treat a SIGNED projection without the required signatures as proof", async () => {
    const f = (fixture = await startUs3DatabaseFixture({ postgresImage }));
    const execution = await executeUs3CleanPass(f);
    await reviewUs3CleanPass(f, execution.executionSetHash);
    const { controller, verdict, input } = await prepare(f);
    await f.source.query(
      "UPDATE qa_verdicts SET state='SIGNED',signed_at=clock_timestamp(),resource_version=resource_version+1 WHERE verdict_id=$1",
      [verdict.verdictId],
    );
    expect(
      (
        await controller.assessDod(
          f.request as never,
          f.workspaceId,
          f.projectId,
          f.workItemId,
          input,
        )
      ).blockerCodes,
    ).toContain("VERDICT_UNSIGNED");
  }, 120_000);
});
