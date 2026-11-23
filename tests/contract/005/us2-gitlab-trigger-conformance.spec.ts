import { describe, expect, it } from "vitest";

import {
  buildGitLabPipelineTrigger,
  type GitLabPipelineProviderCandidate,
  gitLabPipelineTargetCommitment,
  GitLabPipelineTransportFailure,
  GitLabPipelineTriggerError,
  GitLabPipelineTriggerHandler,
  GitLabTriggerReconciliationHandler,
} from "../../../packages/connector-gitlab/src/index.ts";
import type {
  PipelineLookupRequest,
  PipelineTriggerRequest,
  TrustedConnectorOperationContext,
} from "../../../packages/connector-sdk/src/index.ts";
import { buildQaJiraGitLabLocalSeedConfiguration } from "../../../packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const commitSha = "a".repeat(40);
const profile = buildQaJiraGitLabLocalSeedConfiguration("http://127.0.0.1:3002").profile;
const authority = Object.freeze({
  suiteKey: "smoke",
  environmentRef: "environment:test:qa-1@17",
  sourceCommitSha: commitSha,
});
const now = new Date("2026-09-01T08:00:10.000Z");

function context(): TrustedConnectorOperationContext {
  const exact = (id: string, character: string) => ({
    id,
    version: 1,
    contentHash: digest(character),
  });
  const bindingRef = exact("binding-1", "1");
  const pins = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ].map(([logicalRole, capabilityKey], index) => ({
    logicalRole: logicalRole!,
    capabilityKey: capabilityKey!,
    exactContractVersion: "1.0.0",
    bindingRef,
    profileRef: exact(`profile-${logicalRole}`, String(index + 2)),
    connectionRef: exact("connection-1", "5"),
    validationReportRef: exact(`validation-${logicalRole}`, "6"),
    operationSetHash: digest("7"),
  }));
  return {
    scope: { kind: "PROJECT", workspaceId: "workspace-1", projectId: "project-1" },
    actor: { kind: "SERVICE", principalId: "worker-1", serviceKey: "qa-automation" },
    correlationId: "correlation-1",
    causationId: "causation-1",
    effectIdempotencyKey: "qa:automation:effect-1",
    profileRef: { id: "profile-TEST_EXECUTION", version: 1 },
    classification: { key: "INTERNAL", rank: 20 },
    signal: new AbortController().signal,
    authorizationBasisHash: digest("8"),
    configurationPins: pins,
    deadlineAt: "2026-09-01T09:00:00.000Z",
    telemetry: {
      correlationId: "correlation-1",
      causationId: "causation-1",
      operation: "pipeline.trigger",
    },
  };
}

function triggerRequest(): PipelineTriggerRequest {
  return {
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.trigger",
    testSessionId: "session-1",
    automationAttemptId: "attempt-1",
    launchRequestCommitment: digest("9"),
    targetSnapshotRef: "qa-target:session-1",
    targetSnapshotHash: digest("a"),
    suiteBindingRef: { id: "suite-1", version: 1, contentHash: digest("b") },
    suiteBindingHash: digest("b"),
    acceptedParameters: { browser: "chromium" },
    parameterSetHash: digest("c"),
    effectMarkerHash: digest("d"),
    triggerRequestHash: digest("e"),
  };
}

function lookupRequest(): PipelineLookupRequest {
  return {
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.lookup",
    automationAttemptId: "attempt-1",
    effectMarkerHash: digest("d"),
    expectedTargetCommitment: gitLabPipelineTargetCommitment(profile.trigger.ref, commitSha),
    windowStart: "2026-09-01T08:00:00.000Z",
    windowEnd: "2026-09-01T08:02:00.000Z",
    triggerRequestHash: digest("e"),
  };
}

const candidate = (id: string): GitLabPipelineProviderCandidate => ({
  id,
  name: `awp:attempt-1:${digest("e")}`,
  ref: profile.trigger.ref,
  sha: commitSha,
  status: "pending",
  createdAt: "2026-09-01T08:00:05.000Z",
  displayRef: `pipeline:${id}`,
});

describe("GitLab pipeline trigger/lookup conformance", () => {
  it("constructs the typed-input payload solely from Profile mappings and server authority", async () => {
    const built = buildGitLabPipelineTrigger(profile, triggerRequest(), authority);
    expect(built).toMatchObject({
      numericProjectId: 5001,
      path: "/api/v4/projects/5001/trigger/pipeline",
      dialect: "TYPED_INPUTS",
      pipelineName: `awp:attempt-1:${digest("e")}`,
      body: {
        ref: "refs/heads/qa/smoke",
        name: `awp:attempt-1:${digest("e")}`,
        inputs: {
          AWP_REQUEST_MARKER: digest("d"),
          AWP_SUITE_KEY: "smoke",
          AWP_ENVIRONMENT_REF: "environment:test:qa-1@17",
          AWP_COMMIT_SHA: commitSha,
        },
      },
    });
    expect(JSON.stringify(built)).not.toMatch(/private-token|secretref|profileId|connectionId/iu);

    let invoked = 0;
    const handler = new GitLabPipelineTriggerHandler({
      profile,
      authority: () => authority,
      clock: { now: () => now },
      transport: {
        async trigger(input) {
          invoked += 1;
          expect(input).toMatchObject(built);
          expect(input.signal).toBeInstanceOf(AbortSignal);
          return {
            id: 201,
            sha: commitSha,
            status: "pending",
            created_at: "2026-09-01T08:00:05.000Z",
            web_url: "pipeline:201",
          };
        },
      },
    });
    await expect(handler.trigger(context(), triggerRequest())).resolves.toMatchObject({
      externalPipelineId: "201",
      observedState: "QUEUED",
      sourceCommitSha: commitSha,
    });
    expect(invoked).toBe(1);
  });

  it("classifies a proven pre-invocation transport failure without retrying in the handler", async () => {
    let invoked = 0;
    const handler = new GitLabPipelineTriggerHandler({
      profile,
      authority: () => authority,
      clock: { now: () => now },
      transport: {
        async trigger() {
          invoked += 1;
          throw new GitLabPipelineTransportFailure("PRE_INVOCATION", "DNS_UNAVAILABLE");
        },
      },
    });

    const failure = await handler
      .trigger(context(), triggerRequest())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GitLabPipelineTriggerError);
    expect(failure).toMatchObject({
      code: "GITLAB_TRIGGER_PRE_INVOCATION_TRANSPORT_FAILURE",
      recovery: "BOUNDED_RETRY_ALLOWED",
    });
    expect(invoked).toBe(1);
  });

  it.each([
    ["EXACT_ONE", [candidate("301")]],
    ["ZERO", []],
    ["MULTIPLE", [candidate("301"), candidate("302")]],
  ] as const)(
    "returns %s for exact project/marker/ref/SHA/window matches",
    async (expected, candidates) => {
      const calls: string[] = [];
      const handler = new GitLabTriggerReconciliationHandler({
        profile,
        authority: () => authority,
        clock: { now: () => now },
        transport: {
          async list(input) {
            calls.push(`LIST:${input.numericProjectId}`);
            return candidates;
          },
          async readInputs(input) {
            calls.push(`INPUTS:${input.externalPipelineId}`);
            return { AWP_REQUEST_MARKER: digest("d") };
          },
        },
      });
      const result = await handler.lookup(context(), lookupRequest());
      expect(result.outcome).toBe(expected);
      if (result.outcome === "EXACT_ONE") expect(result.receipt.externalPipelineId).toBe("301");
      if (result.outcome === "MULTIPLE") expect(result.matchCommitmentHashes).toHaveLength(2);
      expect(calls.filter((call) => call.startsWith("LIST:"))).toEqual(["LIST:5001"]);
      expect(calls.every((call) => !/cancel|delete|deploy/iu.test(call))).toBe(true);
    },
  );
});
