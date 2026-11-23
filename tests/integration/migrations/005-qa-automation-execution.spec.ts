import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;

beforeAll(async () => {
  postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]!);
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("QA 2055 automated execution constraints", () => {
  it("installs an actor-independent launch claim over scope, Session, and request key", async () => {
    const constraints = (await source!.query(`
      SELECT conname,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid='qa_automation_launch_requests'::regclass AND contype='u'
      ORDER BY conname
    `)) as readonly { conname: string; definition: string }[];
    const claim = constraints.find(({ definition }) =>
      /UNIQUE \(workspace_id, project_id, session_id, request_key_hash\)/iu.test(definition),
    );

    expect(claim).toBeDefined();
    expect(claim!.definition).not.toMatch(/initiator|principal|actor/iu);
    expect(constraints.some(({ definition }) => /UNIQUE \(attempt_id\)/iu.test(definition))).toBe(
      true,
    );
    expect(
      constraints.some(({ definition }) => /UNIQUE \(connector_command_id\)/iu.test(definition)),
    ).toBe(true);
    expect(
      constraints.some(({ definition }) => /UNIQUE \(effect_idempotency_key\)/iu.test(definition)),
    ).toBe(true);
  });

  it("binds each AUTOMATED shared identity to exactly one mode child", async () => {
    const foreignKeys = (await source!.query(`
      SELECT conrelid::regclass::text AS table_name,confrelid::regclass::text AS referenced_table,
             pg_get_constraintdef(oid) AS definition,condeferrable,condeferred
      FROM pg_constraint
      WHERE contype='f' AND conrelid IN(
        'qa_automation_attempts'::regclass,
        'qa_automation_attempt_status_revisions'::regclass,
        'qa_automation_launch_requests'::regclass
      ) ORDER BY table_name,referenced_table,conname
    `)) as readonly {
      table_name: string;
      referenced_table: string;
      definition: string;
      condeferrable: boolean;
      condeferred: boolean;
    }[];
    const identity = foreignKeys.find(
      ({ table_name, referenced_table }) =>
        table_name === "qa_automation_attempts" && referenced_table === "qa_attempt_identities",
    );
    const childTriggers = (await source!.query(`
      SELECT tgname,pg_get_triggerdef(oid) AS definition
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN('qa_attempt_identity_child_guard','qa_automation_attempt_child_guard')
      ORDER BY tgname
    `)) as readonly { tgname: string; definition: string }[];
    const childFunction = (await source!.query(`
      SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname='qa_assert_attempt_child_v2'
    `)) as readonly { definition: string }[];

    expect(identity?.definition).toMatch(
      /attempt_id, workspace_id, project_id, work_item_id, session_id, plan_item_id/iu,
    );
    expect(identity).toMatchObject({ condeferrable: true, condeferred: true });
    expect(childTriggers).toHaveLength(2);
    expect(
      childTriggers.every(({ definition }) => /DEFERRABLE INITIALLY DEFERRED/iu.test(definition)),
    ).toBe(true);
    expect(childFunction[0]?.definition).toMatch(
      /identity_mode\s*=\s*'AUTOMATED'.*automation_count\s*<>\s*1/isu,
    );
    expect(childFunction[0]?.definition).toMatch(/QA_ATTEMPT_MODE_CHILD_MISMATCH/iu);
  });

  it("makes status revisions append-only and enforces the contiguous launch transition", async () => {
    const triggers = (await source!.query(`
      SELECT tgname,pg_get_triggerdef(oid) AS definition
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid='qa_automation_attempt_status_revisions'::regclass
      ORDER BY tgname
    `)) as readonly { tgname: string; definition: string }[];
    const functions = (await source!.query(`
      SELECT proname,pg_get_functiondef(oid) AS definition
      FROM pg_proc
      WHERE proname IN('qa_append_only_guard_qa_automation_attempt_status_revisions','qa_guard_automation_status_insert')
      ORDER BY proname
    `)) as readonly { proname: string; definition: string }[];
    const joined = functions.map(({ definition }) => definition).join("\n");

    expect(
      triggers.some(
        ({ tgname }) => tgname === "qa_append_only_qa_automation_attempt_status_revisions",
      ),
    ).toBe(true);
    expect(triggers.some(({ tgname }) => tgname === "qa_automation_status_insert_guard")).toBe(
      true,
    );
    expect(joined).toMatch(/APPEND_ONLY/iu);
    expect(joined).toMatch(/prior_row\.revision_no\s*<>\s*NEW\.revision_no\s*-\s*1/iu);
    expect(joined).toMatch(
      /prior_row\.state\s*=\s*'CREATED'.*NEW\.state\s*=\s*'TRIGGER_PENDING'/isu,
    );
    expect(joined).toMatch(/QA_AUTOMATION_STATUS_TRANSITION_INVALID/iu);
  });

  it("defers Attempt, launch, status-head, and Core command equality until atomic commit", async () => {
    const foreignKeys = (await source!.query(`
      SELECT conname,confrelid::regclass::text AS referenced_table,pg_get_constraintdef(oid) AS definition,
             condeferrable,condeferred
      FROM pg_constraint
      WHERE contype='f' AND conrelid IN('qa_automation_launch_requests'::regclass,'qa_automation_attempts'::regclass)
      ORDER BY conname
    `)) as readonly {
      conname: string;
      referenced_table: string;
      definition: string;
      condeferrable: boolean;
      condeferred: boolean;
    }[];
    const atomicReferences = foreignKeys.filter(({ referenced_table }) =>
      [
        "connector_commands",
        "qa_automation_attempts",
        "qa_automation_launch_requests",
        "qa_automation_attempt_status_revisions",
      ].includes(referenced_table),
    );
    const integrity = (await source!.query(`
      SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname='qa_assert_automation_attempt_integrity'
    `)) as readonly { definition: string }[];

    expect(atomicReferences.length).toBeGreaterThanOrEqual(5);
    expect(
      atomicReferences.every(({ condeferrable, condeferred }) => condeferrable && condeferred),
    ).toBe(true);
    expect(
      atomicReferences.filter(({ referenced_table }) => referenced_table === "connector_commands"),
    ).toHaveLength(2);
    expect(integrity[0]?.definition).toMatch(
      /launch_row\.connector_command_id\s*<>\s*attempt_row\.connector_command_id/iu,
    );
    expect(integrity[0]?.definition).toMatch(
      /command_effect\s*<>\s*attempt_row\.effect_idempotency_key/iu,
    );
    expect(integrity[0]?.definition).toMatch(/QA_AUTOMATION_ATTEMPT_INTEGRITY_MISMATCH/iu);
  });
});
