import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TypeOrmManualAttemptService } from "../../../packages/competency-qa/src/node.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";

let fixture: Us3DatabaseFixture | undefined;

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("QA 2050 automation foundation constraints", () => {
  it("installs same-scope Suite/session FKs and deferred one-Plan-Item/three-role guards", async () => {
    const constraints = (await fixture!.source.query(`
      SELECT conname,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN(
        'qa_session_automation_suite_fk',
        'qa_suite_current_published_fk',
        'qa_suite_version_validation_report_fk'
      ) ORDER BY conname
    `)) as readonly { conname: string; definition: string }[];
    const triggers = (await fixture!.source.query(`
      SELECT tgname,pg_get_triggerdef(oid) AS definition
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN(
        'qa_automation_session_foundation_guard',
        'qa_automation_pin_foundation_guard',
        'qa_automation_plan_foundation_guard'
      ) ORDER BY tgname
    `)) as readonly { tgname: string; definition: string }[];
    const foundationFunction = (await fixture!.source.query(`
      SELECT pg_get_functiondef(oid) AS definition
      FROM pg_proc WHERE proname='qa_assert_automation_session_foundation'
    `)) as readonly { definition: string }[];

    expect(constraints).toHaveLength(3);
    expect(
      constraints.every(({ definition }) => /workspace_id.*project_id/iu.test(definition)),
    ).toBe(true);
    expect(triggers).toHaveLength(3);
    expect(
      triggers.every(({ definition }) => /DEFERRABLE INITIALLY DEFERRED/iu.test(definition)),
    ).toBe(true);
    expect(foundationFunction[0]?.definition).toMatch(
      /pin_count\s*<>\s*3\s+OR\s+plan_count\s*<>\s*1/iu,
    );
    expect(foundationFunction[0]?.definition).toMatch(
      /SOURCE_CONTEXT.*TEST_EXECUTION.*ARTIFACT_SOURCE/isu,
    );
  });

  it("keeps the MANUAL Attempt identity projection exact and declares deterministic migration backfill", async () => {
    const attempts = new TypeOrmManualAttemptService(fixture!.source);
    const started = await attempts.start({
      workspaceId: fixture!.workspaceId,
      projectId: fixture!.projectId,
      sessionId: fixture!.sessionId,
      planItemId: fixture!.planItemId,
      actor: us3Actor,
      expectedSessionVersion: fixture!.sessionVersion,
      at: "2026-09-01T08:10:00.000Z",
    });
    const rows = (await fixture!.source.query(
      `
      SELECT identity.attempt_id,identity.mode,identity.trigger_kind,identity.attempt_no,
             identity.target_snapshot_hash,manual.content_hash
      FROM qa_attempt_identities identity
      JOIN qa_manual_attempts manual USING(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
      WHERE identity.attempt_id=$1
    `,
      [started.attempt.id],
    )) as readonly Record<string, unknown>[];
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../packages/competency-qa/src/persistence/migrations/2050-qa-automation-foundation.ts",
      ),
      "utf8",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        attempt_id: started.attempt.id,
        mode: "MANUAL",
        trigger_kind: "HUMAN_MANUAL",
        attempt_no: 1,
        target_snapshot_hash: fixture!.targetSnapshotHash,
      }),
    ]);
    expect(migration).toMatch(
      /INSERT\s+INTO\s+qa_attempt_identities[\s\S]*FROM\s+qa_manual_attempts/iu,
    );
    expect(migration).toMatch(
      /QA_MANUAL_ATTEMPT_BACKFILL_COUNT_MISMATCH[\s\S]*QA_MANUAL_ATTEMPT_BACKFILL_HASH_MISMATCH/iu,
    );
  });

  it("makes Suite semantic content and validation-report history append-only", async () => {
    const suiteId = "suite-migration-1";
    const versionId = "suite-migration-1:v1";
    const reportId = "suite-migration-report-1";
    const hash = `sha256:${"a".repeat(64)}` as const;
    const reportHash = `sha256:${"b".repeat(64)}` as const;
    const at = "2026-09-01T08:00:00.000Z";
    await fixture!.source.query(
      `
      INSERT INTO qa_automation_suite_bindings(
        suite_binding_id,workspace_id,project_id,suite_key,resource_version,created_by,created_at,updated_at
      ) VALUES($1,$2,$3,'migration-smoke',1,$4,$5,$5)
    `,
      [suiteId, fixture!.workspaceId, fixture!.projectId, JSON.stringify(us3Actor), at],
    );
    await fixture!.source.query(
      `
      INSERT INTO qa_automation_suite_binding_versions(
        suite_binding_version_id,workspace_id,project_id,suite_binding_id,version,state,owner_principal_id,
        suite_definition_ref,suite_definition_hash,logical_pipeline_key,source_ref_policy_ref,result_job_key,
        logical_execution_contract_hash,accepted_target_types,environment_policy_ref,allowed_parameter_schema_ref,
        allowed_parameter_schema_digest,result_schema_ref,result_schema_digest,result_source_contract,
        artifact_policy_ref,artifact_policy_content_hash,retry_policy_ref,retry_policy_content_hash,
        quarantine_policy_ref,quarantine_policy_content_hash,required_capability_set_hash,content,content_hash,
        created_by,created_at
      ) VALUES($1,$2,$3,$4,1,'DRAFT',$5,$6,$7,'smoke',$8,'machine-result',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
    `,
      [
        versionId,
        fixture!.workspaceId,
        fixture!.projectId,
        suiteId,
        localPersonaIds["executor.alpha"],
        JSON.stringify({ id: "definition", version: 1 }),
        hash,
        JSON.stringify({ id: "refs", version: 1 }),
        hash,
        JSON.stringify(["MERGE_REQUEST"]),
        JSON.stringify({ allowed: ["environment:local"] }),
        JSON.stringify({ id: "parameters", version: 1 }),
        hash,
        JSON.stringify({ id: "result", version: 1 }),
        hash,
        JSON.stringify({ key: "machine-result" }),
        JSON.stringify({ id: "artifact", version: 1 }),
        hash,
        JSON.stringify({ id: "retry", version: 1 }),
        hash,
        JSON.stringify({ id: "quarantine", version: 1 }),
        hash,
        hash,
        JSON.stringify({ suiteKey: "migration-smoke" }),
        hash,
        JSON.stringify(us3Actor),
        at,
      ],
    );
    await fixture!.source.query(
      `
      INSERT INTO qa_automation_suite_validation_reports(
        report_id,workspace_id,project_id,suite_binding_id,suite_binding_version_id,suite_binding_version,
        suite_content_hash,status,core_binding_ref,profile_pin_set_hash,gitlab_discovery_snapshot_ref,
        gitlab_discovery_snapshot_hash,suite_probe_ref,suite_probe_hash,checks,issues,validated_by,
        authorization_basis_hash,created_at,content_hash
      ) VALUES($1,$2,$3,$4,$5,1,$6,'INVALID',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `,
      [
        reportId,
        fixture!.workspaceId,
        fixture!.projectId,
        suiteId,
        versionId,
        hash,
        JSON.stringify({ id: localSeedIds.alphaBinding, version: 2 }),
        hash,
        JSON.stringify({ id: "discovery" }),
        hash,
        JSON.stringify({ id: "probe" }),
        hash,
        JSON.stringify(
          Array.from({ length: 10 }, (_, ordinal) => ({ ordinal, passed: ordinal !== 4 })),
        ),
        JSON.stringify([{ code: "CI_LINT_INVALID", path: "/lint" }]),
        JSON.stringify({ kind: "SERVICE", principalId: "worker" }),
        hash,
        at,
        reportHash,
      ],
    );

    await expect(
      fixture!.source.query(
        "UPDATE qa_automation_suite_binding_versions SET content='{}' WHERE suite_binding_version_id=$1",
        [versionId],
      ),
    ).rejects.toThrow(/QA_AUTOMATION_SUITE_CONTENT_IMMUTABLE/iu);
    await expect(
      fixture!.source.query(
        "DELETE FROM qa_automation_suite_binding_versions WHERE suite_binding_version_id=$1",
        [versionId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      fixture!.source.query(
        "UPDATE qa_automation_suite_validation_reports SET issues='[]' WHERE report_id=$1",
        [reportId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      fixture!.source.query(
        "DELETE FROM qa_automation_suite_validation_reports WHERE report_id=$1",
        [reportId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
  });
});
