import { describe, expect, it } from "vitest";

import {
  createRequiredSessionPlanHeader,
  publishRequiredSessionPlan,
} from "../../packages/competency-qa/src/domain/required-session-plan.ts";

const hash = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
const actor = {
  kind: "HUMAN" as const,
  principalId: "executor",
  issuer: "fake-idp",
  subject: "executor",
};
const requirement = {
  requirementKey: "primary",
  mode: "MANUAL" as const,
  purpose: "feature-validation",
  minimumSessionCount: 1,
  requiredCapabilities: ["manual"],
  targetPolicyRef: { kind: "policy", id: "target", version: "1", contentHash: hash("target") },
  scopePolicyRef: { kind: "policy", id: "scope", version: "1", contentHash: hash("scope") },
  checklistPolicyRefs: [
    { kind: "checklist", id: "check", version: "1", contentHash: hash("check") },
  ],
  resolution: "REQUIRED" as const,
};

describe("RequiredSessionPlan immutable revisions", () => {
  it("bootstraps a stable empty header and publishes only after confirmed READY", () => {
    const header = createRequiredSessionPlanHeader({
      id: "plan",
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      extensionId: "ext",
      createdAt: "2026-08-30T10:00:00.000Z",
    });
    expect(header).toMatchObject({ currentRevisionRef: null, resourceVersion: 1 });
    expect(() =>
      publishRequiredSessionPlan({
        header,
        expectedResourceVersion: 1,
        readiness: {
          confirmed: false,
          proofRef: { id: "assessment", version: 1, contentHash: hash("ready") },
        },
        operationalStatus: "NEW",
        requirements: [requirement],
        catalogs: {
          target: [requirement.targetPolicyRef],
          scope: [requirement.scopePolicyRef],
          checklist: requirement.checklistPolicyRefs,
        },
        actor,
        reason: "Initial plan",
        publishedAt: "2026-08-30T10:01:00.000Z",
        revisionId: "plan-v1",
      }),
    ).toThrow("QA_PLAN_REQUIRES_CONFIRMED_READY");
  });

  it("rejects zero REQUIRED slots, stale CAS and terminal revisions", () => {
    const header = createRequiredSessionPlanHeader({
      id: "plan",
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      extensionId: "ext",
      createdAt: "2026-08-30T10:00:00.000Z",
    });
    const base = {
      header,
      expectedResourceVersion: 1,
      readiness: {
        confirmed: true,
        proofRef: { id: "assessment", version: 1, contentHash: hash("ready") },
      },
      operationalStatus: "READY" as const,
      catalogs: {
        target: [requirement.targetPolicyRef],
        scope: [requirement.scopePolicyRef],
        checklist: requirement.checklistPolicyRefs,
      },
      actor,
      reason: "Initial plan",
      publishedAt: "2026-08-30T10:01:00.000Z",
      revisionId: "plan-v1",
    };
    expect(() =>
      publishRequiredSessionPlan({
        ...base,
        requirements: [
          {
            ...requirement,
            resolution: "WAIVED" as const,
            waiverRef: { id: "waiver", version: 1, contentHash: hash("waiver") },
          },
        ],
      }),
    ).toThrow("QA_PLAN_REQUIRES_REQUIRED_SLOT");
    const published = publishRequiredSessionPlan({ ...base, requirements: [requirement] });
    expect(() =>
      publishRequiredSessionPlan({
        ...base,
        header: published.header,
        expectedResourceVersion: 1,
        operationalStatus: "READY",
        requirements: [requirement],
        revisionId: "plan-v2",
      }),
    ).toThrow("QA_PLAN_STALE_VERSION");
    expect(() =>
      publishRequiredSessionPlan({
        ...base,
        header: published.header,
        expectedResourceVersion: 2,
        operationalStatus: "DONE",
        requirements: [requirement],
        revisionId: "plan-v2",
      }),
    ).toThrow("QA_PLAN_TERMINAL_OPERATIONAL_STATE");
  });
});
