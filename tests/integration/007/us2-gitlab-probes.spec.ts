import { describe, expect, it } from "vitest";

import { assessProjectCapabilityMode } from "../../../packages/competency-qa/src/application/project-capability-mode.ts";
import { createGitLabCapabilityProbes } from "../../../packages/runtime-composition/src/gitlab/profile-validation.ts";
import { ProjectCapabilityProbeWorker } from "../../../packages/runtime-composition/src/onboarding/probe-worker.ts";
import {
  exactRef,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

const valid = () => ({
  probeIdPrefix: "gitlab-probe",
  ...projectScope(),
  bindingRef: exactRef("binding-full"),
  profileRef: exactRef("gitlab-profile"),
  connectionRef: exactRef("gitlab-connection"),
  mappingRef: exactRef("gitlab-mapping"),
  validationReportRef: exactRef("binding-validation"),
  expectedPipelineContractHash: testHash("pipeline-contract"),
  observedPipelineContractHash: testHash("pipeline-contract"),
  availableOperations: [
    "merge-request.read",
    "commit.read",
    "build.read",
    "pipeline.trigger",
    "pipeline.read",
    "pipeline.lookup",
    "artifact.metadata",
    "artifact.stream",
  ],
  observedAt: onboardingFixture.now,
  validUntil: onboardingFixture.later,
  now: onboardingFixture.now,
});

describe("Feature 007 US2 exact GitLab probes", () => {
  it("normalizes exact source, trigger/status and artifact-read capabilities", () => {
    const probes = createGitLabCapabilityProbes(valid());
    expect(probes.map(({ logicalRole, status }) => [logicalRole, status])).toEqual([
      ["SOURCE_CONTEXT", "AVAILABLE"],
      ["TEST_EXECUTION", "AVAILABLE"],
      ["ARTIFACT_SOURCE", "AVAILABLE"],
    ]);
    expect(probes.every(({ bindingRef }) => bindingRef.id === "binding-full")).toBe(true);
  });

  it("rejects stale, cross-Project and mismatched pipeline observations", () => {
    expect(() =>
      createGitLabCapabilityProbes({ ...valid(), validUntil: "2026-09-03T11:59:59.000Z" }),
    ).toThrow("GITLAB_PROBE_STALE");
    expect(() =>
      createGitLabCapabilityProbes({
        ...valid(),
        observedScope: projectScope(onboardingFixture.projectB),
      }),
    ).toThrow("GITLAB_PROBE_SCOPE_MISMATCH");
    expect(() =>
      createGitLabCapabilityProbes({
        ...valid(),
        observedPipelineContractHash: testHash("other-contract"),
      }),
    ).toThrow("GITLAB_PIPELINE_CONTRACT_MISMATCH");
  });

  it("appends observations and an assessment without granting connector authority over Project state", async () => {
    const observations = createGitLabCapabilityProbes(valid());
    const appended: unknown[] = [];
    const assessment = assessProjectCapabilityMode({
      ...projectScope(),
      bindingRef: exactRef("binding-full"),
      contextRef: exactRef("context"),
      requirementSetRef: exactRef("requirements"),
      acceptedAutomationSuite: {
        suiteBindingRef: exactRef("suite"),
        bindingRef: exactRef("binding-full"),
        environmentRef: exactRef("environment"),
        evidencePolicyRef: exactRef("policy"),
      },
      now: onboardingFixture.now,
      probes: [
        {
          ref: exactRef("manual"),
          requirement: "MANUAL",
          status: "AVAILABLE",
          validUntil: onboardingFixture.later,
        },
        {
          ref: exactRef("automation"),
          requirement: "AUTOMATION",
          status: "AVAILABLE",
          validUntil: onboardingFixture.later,
        },
      ],
    });
    const worker = new ProjectCapabilityProbeWorker(
      {
        due: async () => [
          {
            ...projectScope(),
            bindingRef: exactRef("binding-full"),
            qaProjectContextRef: exactRef("context"),
            requirementSetRef: exactRef("requirements"),
          },
        ],
      },
      { execute: async () => observations },
      {
        appendProbes: async (values) => {
          appended.push(...values);
        },
        assess: async () => assessment,
        appendAssessment: async (value) => {
          appended.push(value);
        },
      },
      () => onboardingFixture.now,
    );
    await expect(worker.run()).resolves.toMatchObject({
      checked: 1,
      assessments: [{ derivedMode: "FULL_QA" }],
    });
    expect(appended).toHaveLength(4);
  });
});
