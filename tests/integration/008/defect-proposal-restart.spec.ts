import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { QaDefectsController } from "../../../apps/api/src/extensions/qa-defects.controller.ts";
import { createLocalQaDefectApproval } from "../../../apps/api/src/local/local-qa-defect-approval.ts";
import { createLocalQaDefectPublication } from "../../../apps/api/src/local/local-qa-defect-publication.ts";
import { startUs3DatabaseFixture, stopUs3DatabaseFixture } from "../../support/002-us3-database.ts";
import { create008FrozenProductFinding } from "../../support/008-frozen-finding.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 durable defect wording proposals",
  () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });
    it.each(POSTGRES_TEST_IMAGES)(
      "survives API restart and keeps exact scope/hash/source when accepted on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        vi.stubEnv("AWP_QA_DRAFT_ASSISTANT", "valid");
        try {
          const frozen = await create008FrozenProductFinding(f);
          const first = new QaDefectsController(
            f.source,
            createLocalQaDefectPublication(f.source),
            createLocalQaDefectApproval(f.source, createLocalQaDefectPublication(f.source)),
          );
          const proposed = await first.propose(
            f.request as never,
            f.workspaceId,
            f.projectId,
            f.workItemId,
            frozen.findingId,
            { frozenFindingReviewRef: frozen.frozenFindingReviewRef },
            f.response,
          );
          expect(proposed.source).toBe("DETERMINISTIC_FALLBACK");
          await f.source.destroy();
          await f.source.initialize();
          const restarted = new QaDefectsController(
            f.source,
            createLocalQaDefectPublication(f.source),
            createLocalQaDefectApproval(f.source, createLocalQaDefectPublication(f.source)),
          );
          expect(
            await restarted.proposal(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              frozen.findingId,
              proposed.proposalId,
            ),
          ).toEqual(proposed);
          await expect(
            f.source.query(
              "UPDATE qa_defect_draft_proposals SET content='{}' WHERE proposal_id=$1",
              [proposed.proposalId],
            ),
          ).rejects.toThrow("QA_DEFECT_PROPOSAL_IMMUTABLE");
          await expect(
            restarted.proposal(
              f.request as never,
              f.workspaceId,
              f.projectId,
              randomUUID(),
              frozen.findingId,
              proposed.proposalId,
            ),
          ).rejects.toThrow("QA_DEFECT_PROPOSAL_NOT_FOUND");
          await expect(
            restarted.create(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              frozen.findingId,
              `W/"${frozen.resourceVersion}"`,
              {
                source: "MODEL_PROPOSAL",
                acceptedProposalRef: {
                  id: proposed.proposalId,
                  contentHash: proposed.proposalHash,
                },
              },
              f.response,
            ),
          ).rejects.toThrow("QA_DEFECT_PROPOSAL_SOURCE_MISMATCH");
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(Date.parse(proposed.expiresAt));
          await expect(
            restarted.create(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              frozen.findingId,
              `W/"${frozen.resourceVersion}"`,
              {
                source: "DETERMINISTIC_FALLBACK",
                acceptedProposalRef: {
                  id: proposed.proposalId,
                  contentHash: proposed.proposalHash,
                },
              },
              f.response,
            ),
          ).rejects.toThrow("QA_DEFECT_PROPOSAL_STALE_OR_MISMATCHED");
          vi.useRealTimers();
          await expect(
            restarted.create(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              frozen.findingId,
              `W/"${frozen.resourceVersion}"`,
              {
                source: "DETERMINISTIC_FALLBACK",
                acceptedProposalRef: {
                  id: proposed.proposalId,
                  contentHash: `sha256:${"f".repeat(64)}`,
                },
              },
              f.response,
            ),
          ).rejects.toThrow("QA_DEFECT_PROPOSAL_STALE_OR_MISMATCHED");
          const draft = await restarted.create(
            f.request as never,
            f.workspaceId,
            f.projectId,
            f.workItemId,
            frozen.findingId,
            `W/"${frozen.resourceVersion}"`,
            {
              source: "DETERMINISTIC_FALLBACK",
              acceptedProposalRef: { id: proposed.proposalId, contentHash: proposed.proposalHash },
            },
            f.response,
          );
          expect(draft.provenance).toMatchObject({
            source: "DETERMINISTIC_FALLBACK_ACCEPTED",
            acceptedProposalRef: { id: proposed.proposalId, contentHash: proposed.proposalHash },
          });
          expect(draft.payload.title).toBe(proposed.title);
          await f.source.query(
            "UPDATE work_items SET classification_key='CONFIDENTIAL' WHERE id=$1",
            [f.workItemId],
          );
          await expect(
            restarted.proposal(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              frozen.findingId,
              proposed.proposalId,
            ),
          ).rejects.toThrow("QA_DEFECT_PROPOSAL_CLASSIFICATION_DENIED");
          await expect(
            restarted.drafts(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              frozen.findingId,
            ),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            restarted.links(f.request as never, f.workspaceId, f.projectId, f.workItemId),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            restarted.link(
              f.request as never,
              f.workspaceId,
              f.projectId,
              f.workItemId,
              randomUUID(),
            ),
          ).rejects.toMatchObject({ status: 403 });
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
