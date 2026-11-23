import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  executeUs3CleanPass,
  reviewUs3CleanPass,
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";

let fixture: Us3DatabaseFixture | undefined;
let manifestRevisionId = "";
let reviewId = "";

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
  const execution = await executeUs3CleanPass(fixture);
  const reviewed = await reviewUs3CleanPass(fixture, execution.executionSetHash);
  manifestRevisionId = reviewed.manifestRevision.manifestRevisionId;
  reviewId = reviewed.sessionReview.id;
}, 120_000);
afterAll(async () => await stopUs3DatabaseFixture(fixture));

describe("US3 signed evidence append-only DB guards", () => {
  it("rejects UPDATE and DELETE while scoped history remains readable", async () => {
    const source = fixture!.source;
    await expect(
      source.query(
        "UPDATE qa_evidence_manifest_revisions SET content_hash=content_hash WHERE manifest_revision_id=$1",
        [manifestRevisionId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      source.query("DELETE FROM qa_evidence_manifest_revisions WHERE manifest_revision_id=$1", [
        manifestRevisionId,
      ]),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      source.query(
        "UPDATE qa_session_reviews SET outcome_summary=outcome_summary WHERE session_review_id=$1",
        [reviewId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      source.query("DELETE FROM qa_session_reviews WHERE session_review_id=$1", [reviewId]),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    const visible = await source.query(
      "SELECT r.session_review_id,m.manifest_revision_id FROM qa_session_reviews r JOIN qa_evidence_manifest_revisions m ON m.workspace_id=r.workspace_id AND m.project_id=r.project_id AND m.manifest_revision_id=r.manifest_revision_id WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.session_id=$3",
      [fixture!.workspaceId, fixture!.projectId, fixture!.sessionId],
    );
    expect(visible).toEqual([
      { session_review_id: reviewId, manifest_revision_id: manifestRevisionId },
    ]);
    expect(
      await source.query(
        "SELECT count(*)::int AS count FROM qa_session_reviews WHERE workspace_id=$1 AND project_id<>$2",
        [fixture!.workspaceId, fixture!.projectId],
      ),
    ).toEqual([{ count: 0 }]);
  });
});
