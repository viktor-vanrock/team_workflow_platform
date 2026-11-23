import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  QaPostCloseCorrectionStore,
  recordPostCloseCorrection,
  TypeOrmQaPostCloseCorrectionRepository,
} from "../../packages/competency-qa/src/node.ts";
import {
  executeUs3CleanPass,
  reviewUs3CleanPass,
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../support/002-us3-database.ts";

let fixture: Us3DatabaseFixture | undefined;
beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
}, 120_000);
afterAll(async () => await stopUs3DatabaseFixture(fixture));

describe("US5 persistent post-close clerical manifest revision", () => {
  it("moves latest only, preserves adjudicative pointer and appends a HUMAN marker", async () => {
    const f = fixture!;
    const execution = await executeUs3CleanPass(f);
    const reviewed = await reviewUs3CleanPass(f, execution.executionSetHash);
    const before = (
      (await f.source.query(
        "SELECT m.*,r.manifest,r.signature,r.evidence_policy_ref FROM qa_evidence_manifests m JOIN qa_evidence_manifest_revisions r ON r.manifest_revision_id=m.latest_revision_id WHERE m.manifest_id=$1",
        [reviewed.manifestRevision.manifestId],
      )) as readonly Record<string, unknown>[]
    )[0]!;
    const currentManifest = before.manifest as Record<string, unknown>;
    const previousRef = {
      id: String(before.latest_revision_id),
      version: Number(currentManifest.version),
      contentHash: String(currentManifest.contentHash) as `sha256:${string}`,
    };
    const store = new QaPostCloseCorrectionStore({
      manifestId: reviewed.manifestRevision.manifestId,
      latestRevisionRef: previousRef,
      latestAdjudicativeRevisionRef: previousRef,
      resourceVersion: Number(before.resource_version),
      content: {
        ...currentManifest,
        note: String(currentManifest.outcomeSummary),
        artifactRefs: [],
      },
    });
    const basis = {
      kind: "PROJECT" as const,
      policyVersion: "qa-local@1",
      membershipRef: { id: "membership", version: 1 },
      roleAssignmentRefs: [{ id: "executor", version: 1 }],
      entitlementRefs: [{ id: "post-close", version: 1 }],
      skillContext: "NOT_APPLICABLE" as const,
    };
    const result = await recordPostCloseCorrection({
      store,
      context: {
        actor: us3Actor,
        scope: { kind: "PROJECT", workspaceId: f.workspaceId, projectId: f.projectId },
        correlationId: "post-close-correlation",
        causationId: "post-close-causation",
        authorizationBasis: basis,
      },
      workItemId: f.workItemId,
      manifestId: reviewed.manifestRevision.manifestId,
      ifMatch: Number(before.resource_version),
      expectedPreviousRef: previousRef,
      patch: { note: "Clerical wording corrected after DONE; adjudication unchanged." },
      annotations: [{ field: "note", reason: "Correct a display-only typo" }],
      markerId: "post-close-marker-1",
      revisionId: "manifest-clerical-v2",
      at: "2026-08-31T13:00:00.000Z",
    });
    const content = {
      ...currentManifest,
      ...result.manifest.content,
      manifestRevisionId: result.marker.clericalRevisionRef.id,
      version: result.marker.clericalRevisionRef.version,
      kind: "CLERICAL",
      previousRevisionRef: result.marker.previousRevisionRef,
      correctionReason: "Correct a display-only typo",
      contentHash: result.marker.clericalRevisionRef.contentHash,
    };
    await new TypeOrmQaPostCloseCorrectionRepository(f.source).append({
      marker: result.marker,
      scope: { workspaceId: f.workspaceId, projectId: f.projectId },
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      expectedManifestResourceVersion: Number(before.resource_version),
      revision: {
        manifestId: reviewed.manifestRevision.manifestId,
        content,
        signature: before.signature,
        evidencePolicyRef: before.evidence_policy_ref,
      },
    });
    const header = await f.source.query(
      "SELECT latest_revision_id,latest_adjudicative_revision_id,revision_count,resource_version FROM qa_evidence_manifests WHERE manifest_id=$1",
      [reviewed.manifestRevision.manifestId],
    );
    expect(header).toEqual([
      {
        latest_revision_id: "manifest-clerical-v2",
        latest_adjudicative_revision_id: previousRef.id,
        revision_count: 2,
        resource_version: "2",
      },
    ]);
    expect(
      await f.source.query(
        "SELECT kind,previous_revision_id FROM qa_evidence_manifest_revisions WHERE manifest_revision_id='manifest-clerical-v2'",
      ),
    ).toEqual([{ kind: "CLERICAL", previous_revision_id: previousRef.id }]);
    expect(
      await f.source.query(
        "SELECT basis,manifest_id FROM qa_post_close_correction_markers WHERE marker_id='post-close-marker-1'",
      ),
    ).toEqual([{ basis: "HUMAN", manifest_id: reviewed.manifestRevision.manifestId }]);
  });
});
