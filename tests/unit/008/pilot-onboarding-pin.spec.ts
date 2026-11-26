import { describe, expect, it, vi } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { matchesPilotOnboardingPin } from "../../../packages/runtime-composition/src/pilot/onboarding-pin.ts";

const scope = { workspaceId: "workspace", projectId: "project" };
const actionId = "70000000-0000-4000-8000-000000000001";
function hashed<T extends object>(body: T) {
  return { ...body, contentHash: pilotContentHash(body) };
}
function fixture() {
  const previous = hashed({
    ...scope,
    onboardingId: "onboarding",
    revisionId: "before",
    version: 1,
    stage: "SHADOW",
    operationalState: "ACTIVE",
  });
  const pin = {
    id: previous.revisionId,
    version: 1,
    contentHash: previous.contentHash as `sha256:${string}`,
  };
  const current = hashed({
    ...scope,
    onboardingId: "onboarding",
    revisionId: "after",
    version: 2,
    stage: "PILOT_ACTIVE",
    operationalState: "ACTIVE",
    causationId: actionId,
    actor: { principalId: "approver" },
    reasonCode: "ONBOARDING_PILOT_ACTIVATED",
  });
  const candidate = hashed({
    ...scope,
    kind: "ONBOARDING_PILOT_ACTIVATE",
    actionId,
    expectedOnboardingVersion: 1,
    targetRef: pin,
    initiator: { principalId: "initiator" },
  });
  const subject = {
    actionKind: candidate.kind,
    actionId,
    targetHash: candidate.contentHash,
    initiatorPrincipalId: "initiator",
    approver: { principalId: "approver", roleKey: "system-administrator" },
    stepUpAt: "2026-01-01T00:00:00Z",
  };
  const proof = {
    previous,
    content_hash: previous.contentHash,
    candidate,
    candidate_ref: candidate,
    persisted_hash: candidate.contentHash,
    action_hash: candidate.contentHash,
    subject,
    subject_hash: candidate.contentHash,
  };
  return { previous, pin, current, proof };
}

describe("pilot onboarding pin", () => {
  it("accepts the immediate predecessor only with exact consumed independent approval", async () => {
    const f = fixture();
    const source = { query: vi.fn(async () => [f.proof]) };
    expect(await matchesPilotOnboardingPin(source, scope, f.pin, f.current)).toBe(true);
    expect(source.query).toHaveBeenCalledOnce();
  });
  it("rejects changed approval, stale versions and missing proof", async () => {
    const f = fixture();
    const selfApproval = {
      ...f.proof,
      subject: { ...f.proof.subject, approver: { principalId: "initiator" } },
    };
    expect(
      await matchesPilotOnboardingPin(
        { query: async () => [selfApproval] },
        scope,
        f.pin,
        f.current,
      ),
    ).toBe(false);
    expect(
      await matchesPilotOnboardingPin({ query: async () => [] }, scope, f.pin, f.current),
    ).toBe(false);
    expect(
      await matchesPilotOnboardingPin(
        { query: async () => [f.proof] },
        scope,
        { ...f.pin, contentHash: `sha256:${"f".repeat(64)}` },
        f.current,
      ),
    ).toBe(false);
  });
  it("accepts the exact current active revision without a predecessor lookup", async () => {
    const f = fixture();
    const query = vi.fn();
    expect(
      await matchesPilotOnboardingPin(
        { query },
        scope,
        {
          id: f.current.revisionId,
          version: f.current.version,
          contentHash: f.current.contentHash as `sha256:${string}`,
        },
        f.current,
      ),
    ).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
