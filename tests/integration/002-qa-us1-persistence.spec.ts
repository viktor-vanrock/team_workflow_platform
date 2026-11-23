import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type QaRequestExtension,
  type QaRequestInputRevision,
  QaTypeOrmIntakeConfirmationWriter,
} from "../../packages/competency-qa/src/node.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import {
  localSeedIds,
  runLocalSeed,
} from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

const digest = (char: string) => `sha256:${char.repeat(64)}` as const;
const contextId = "a1000000-0000-4000-8000-000000000001";
const inputId = "a2000000-0000-4000-8000-000000000001";
const extensionId = "a3000000-0000-4000-8000-000000000001";
const actor = {
  kind: "HUMAN" as const,
  principalId: "30000000-0000-4000-8000-000000000003",
  issuer: "https://fake-idp:4443/oidc",
  subject: "requester-alpha",
};

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
  await runLocalSeed(source);
  await source.query(
    "INSERT INTO qa_project_contexts(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1)",
    [contextId, localSeedIds.workspaceFunctional, localSeedIds.alpha],
  );
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
});

describe("US1 QA request persistence", () => {
  it("atomically inserts extension/current input and replays exactly", async () => {
    const revision: QaRequestInputRevision = {
      schemaVersion: 1,
      inputRevisionId: inputId,
      version: 1,
      previousRevisionRef: null,
      workspaceId: localSeedIds.workspaceFunctional,
      projectId: localSeedIds.alpha,
      workItemId: localSeedIds.workItem,
      definitionRef: { key: "qa.validation", version: "1.0.0" },
      acceptedDraftRef: {
        kind: "intake-draft",
        id: "a4000000-0000-4000-8000-000000000001",
        version: "1",
        contentHash: digest("1"),
      },
      externalRequestRef: {
        kind: "request",
        id: "REQ-persistence-1",
        version: "1",
        contentHash: digest("2"),
      },
      operationalBindingRef: { id: localSeedIds.alphaBinding, version: 1 },
      originalRequesterRef: actor,
      title: "Persist sparse request",
      requestKind: "feature-validation",
      blockersDeclared: false,
      blockers: [],
      dependenciesDeclared: false,
      dependencies: [],
      dataClassificationKey: "INTERNAL",
      responseChannelResolution: {
        state: "MISSING",
        requesterPrincipal: actor,
        resolutionPolicyRef: {
          key: "qa.response-channel-resolution",
          version: "1.0.0",
          contentHash: digest("3"),
        },
        evaluatedAt: "2026-08-30T10:00:00.000Z",
        missingReasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
      },
      readyEffectGuard: { observedState: "NONE", expectedAggregateVersion: 1 },
      invalidatedState: {
        readinessAssessmentRefs: [],
        waiverRefs: [],
        pendingReadyCommandRefs: [],
      },
      changeReasonCode: "INITIAL_CONFIRMED_DRAFT",
      contentHash: digest("4"),
      recordedBy: actor,
      authorizationBasisHash: digest("5"),
      recordedAt: "2026-08-30T10:00:00.000Z",
      correlationId: "a5000000-0000-4000-8000-000000000001",
    };
    const extension: QaRequestExtension = {
      schemaVersion: 1,
      extensionId,
      workspaceId: revision.workspaceId,
      projectId: revision.projectId,
      workItemId: revision.workItemId,
      definitionRef: revision.definitionRef,
      currentRequestInputRevisionRef: {
        id: revision.inputRevisionId,
        version: 1,
        contentHash: revision.contentHash,
      },
      projectContextRef: { id: contextId, version: 1, contentHash: digest("6") },
      dorRuleSetRef: { key: "qa.dor", version: "1.0.0", contentHash: digest("7") },
      dodRuleSetRef: { key: "qa.dod", version: "1.0.0", contentHash: digest("8") },
      evidencePolicyRef: { key: "qa.evidence", version: "1.0.0", contentHash: digest("9") },
      riskReviewPolicyRef: {
        id: "a6000000-0000-4000-8000-000000000001",
        version: 1,
        contentHash: digest("a"),
      },
      adjudicativeAggregateHash: digest("b"),
      completionDispatchGuard: { state: "OPEN" },
      resourceVersion: 1,
      contentHash: digest("c"),
      createdBy: actor,
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
      correlationId: revision.correlationId,
    };
    const writer = new QaTypeOrmIntakeConfirmationWriter();
    const apply = async () =>
      await source!.transaction(
        async (manager) =>
          await writer.persist(
            {
              transactionId: "pg",
              native: manager,
              contributionKey: "qa.request-create.confirmation",
              idempotencyKey: "confirm:pg:1",
            },
            { extension, initialInput: revision },
          ),
      );
    await expect(apply()).resolves.toEqual({ replayed: false });
    await expect(apply()).resolves.toEqual({ replayed: true });
    expect(await source!.query("SELECT count(*)::int AS count FROM qa_request_extensions")).toEqual(
      [{ count: 1 }],
    );
    expect(
      await source!.query("SELECT count(*)::int AS count FROM qa_request_input_revisions"),
    ).toEqual([{ count: 1 }]);
  });

  it("rejects append-only mutation and any post-v1 frozen tuple drift", async () => {
    await expect(
      source!.query(
        "UPDATE qa_request_input_revisions SET title='tampered' WHERE input_revision_id=$1",
        [inputId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      source!.query(
        `
      INSERT INTO qa_request_input_revisions(
        input_revision_id,workspace_id,project_id,work_item_id,version,previous_revision_id,previous_revision_version,previous_content_hash,
        definition_key,definition_version,accepted_draft_id,accepted_draft_version,accepted_draft_content_hash,external_request_id,
        external_request_version,external_request_content_hash,operational_binding_id,operational_binding_version,original_requester_ref,title,
        request_kind,data_classification_key,content_hash,content,recorded_by,authorization_basis_hash,recorded_at,correlation_id,causation_id
      ) SELECT $1,workspace_id,project_id,work_item_id,2,input_revision_id,1,content_hash,definition_key,definition_version,
        accepted_draft_id,accepted_draft_version,accepted_draft_content_hash,external_request_id,external_request_version,external_request_content_hash,
        operational_binding_id,operational_binding_version,original_requester_ref,'forged-title',request_kind,data_classification_key,$2,content,
        recorded_by,authorization_basis_hash,recorded_at,$3,NULL
      FROM qa_request_input_revisions WHERE input_revision_id=$4`,
        [
          "a2000000-0000-4000-8000-000000000002",
          digest("d"),
          "a5000000-0000-4000-8000-000000000002",
          inputId,
        ],
      ),
    ).rejects.toThrow(/FROZEN_TUPLE_DRIFT/iu);
    expect(
      await source!.query("SELECT count(*)::int AS count FROM qa_request_input_revisions"),
    ).toEqual([{ count: 1 }]);
  });
});
