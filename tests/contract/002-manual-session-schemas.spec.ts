import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { OfflineSchemaRegistry } from "../../packages/platform-contracts/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/examples");
const registry = new OfflineSchemaRegistry();

const schema = Object.freeze({
  target: "urn:awp:schemas:qa:target-snapshot:v1",
  scope: "urn:awp:schemas:qa:scope-snapshot:v1",
  session: "urn:awp:schemas:qa:test-session:v1",
  planItem: "urn:awp:schemas:qa:plan-item:v1",
  attempt: "urn:awp:schemas:qa:manual-attempt:v1",
  observation: "urn:awp:schemas:qa:observation:v1",
  result: "urn:awp:schemas:qa:plan-item-result-revision:v1",
  resultCommand: "urn:awp:schemas:qa:plan-item-result-revision:v1#/$defs/RevisionCommand",
  resultPredecessor:
    "urn:awp:schemas:qa:plan-item-result-revision:v1#/$defs/RevisionPredecessorDecision",
});

type JsonObject = Record<string, unknown>;

async function fixture(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(examples, path), "utf8")) as JsonObject;
}

function expectValid(schemaId: string, value: unknown): void {
  expect(() => registry.validateById(schemaId, value)).not.toThrow();
}

function expectInvalid(schemaId: string, value: unknown): void {
  expect(() => registry.validateById(schemaId, value)).toThrow();
}

function records(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

function exactRefMatches(ref: JsonObject, value: JsonObject, idField: string): boolean {
  return ref.id === value[idField] && ref.contentHash === value.contentHash;
}

function cleanPassSemantics(
  result: JsonObject,
  attempts: readonly JsonObject[],
  observations: readonly JsonObject[],
  currentLeafObservationIds: ReadonlySet<unknown>,
): boolean {
  if (result.result !== "PASS") return false;
  const attemptRefs = records(result.consideredAttemptRefs);
  const observationRefs = records(result.consideredObservationRefs);
  const resolvedAttempts = attemptRefs.map((ref) =>
    attempts.find((attempt) => exactRefMatches(ref, attempt, "attemptId")),
  );
  const resolvedObservations = observationRefs.map((ref) =>
    observations.find((observation) => exactRefMatches(ref, observation, "observationId")),
  );
  if (resolvedAttempts.some((attempt) => !attempt)) return false;
  if (resolvedObservations.some((observation) => !observation)) return false;
  if (
    resolvedObservations.some(
      (observation) => !currentLeafObservationIds.has(observation?.observationId),
    )
  )
    return false;
  return resolvedObservations.some(
    (observation) =>
      observation?.kind === "POSITIVE" &&
      resolvedAttempts.some(
        (attempt) =>
          attempt !== undefined &&
          attempt.attemptId === observation.attemptId &&
          attempt.result === "PASS",
      ),
  );
}

interface ServerResultSnapshot {
  readonly attemptSetHash: unknown;
  readonly maximumAttemptNo: unknown;
  readonly observationSetHash: unknown;
  readonly observationCount: unknown;
}

function commandCasMatches(command: JsonObject, current: ServerResultSnapshot): boolean {
  return (
    command.expectedAttemptSetHash === current.attemptSetHash &&
    command.expectedMaximumAttemptNo === current.maximumAttemptNo &&
    command.expectedObservationSetHash === current.observationSetHash &&
    command.expectedObservationCount === current.observationCount
  );
}

function flakyBasisMatches(command: JsonObject, expected: JsonObject): boolean {
  return JSON.stringify(command.flakyDispositionBasis) === JSON.stringify(expected);
}

describe("Feature 002 manual Session design contracts", () => {
  it("keeps target/scope/session/plan item schemas closed and MANUAL-only", async () => {
    const missingTestData = await fixture(
      "negative/target-snapshot-missing-test-data.invalid.json",
    );
    const testDataRef = {
      kind: "test-data",
      id: "checkout-fixture-v3",
      version: "3",
      contentHash: "sha256:2020202020202020202020202020202020202020202020202020202020202020",
    };
    const target: JsonObject = { ...missingTestData, testDataRef };
    const scope = {
      schemaVersion: 1,
      scopeSnapshotId: "21212121-2121-4121-8121-212121212121",
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      purpose: "Validate checkout smoke behavior",
      agreedScope: "Checkout happy path and payment-decline path",
      acceptanceOutcome: "Documented behavior is observed on the pinned target",
      inclusions: ["checkout"],
      exclusions: ["production traffic"],
      checklistDefinition: {
        kind: "session-checklist-snapshot",
        snapshotHash: "sha256:2121212121212121212121212121212121212121212121212121212121212121",
      },
      contentHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      capturedAt: "2026-08-27T12:05:00Z",
    };
    const session = await fixture("positive/test-session-completed.valid.json");
    const automated = await fixture("negative/automated-session.invalid.json");
    const plannedWithResult = await fixture("negative/plan-item-planned-with-result.invalid.json");
    const terminalWithWaiver = await fixture(
      "negative/plan-item-terminal-with-waiver.invalid.json",
    );

    expectValid(schema.target, target);
    expectInvalid(schema.target, missingTestData);
    expectValid(schema.scope, scope);
    expectValid(schema.session, session);
    expectInvalid(schema.session, automated);
    expectInvalid(schema.planItem, plannedWithResult);
    expectInvalid(schema.planItem, terminalWithWaiver);
  });

  it("publishes outcome/review/manifest only in the atomic COMPLETED branch", async () => {
    const completed = await fixture("positive/test-session-completed.valid.json");
    const preCompleted = {
      ...completed,
      state: "REVIEW_REQUIRED",
    };
    const forbidden = [
      "sessionOutcome",
      "reviewedBy",
      "latestSessionReviewRef",
      "evidenceManifestRevisionRef",
      "completedAt",
    ];
    const reviewRequired = Object.fromEntries(
      Object.entries(preCompleted).filter(([key]) => !forbidden.includes(key)),
    );
    expectValid(schema.session, reviewRequired);
    for (const key of forbidden) {
      expectInvalid(schema.session, { ...reviewRequired, [key]: completed[key] });
    }
    expectInvalid(
      schema.session,
      Object.fromEntries(
        Object.entries(completed).filter(([key]) => key !== "evidenceManifestRevisionRef"),
      ),
    );
  });

  it("separates RUNNING and COMPLETED Attempt state and requires cancellation reason iff CANCELLED", async () => {
    const completed = await fixture("positive/manual-attempt.valid.json");
    const cancelled = await fixture("positive/manual-attempt-cancelled.valid.json");
    const cancelledWithoutReason = await fixture(
      "negative/manual-attempt-cancelled-without-reason.invalid.json",
    );
    const planResult = await fixture("negative/manual-attempt-plan-result.invalid.json");
    const running = Object.fromEntries(
      Object.entries(completed).filter(
        ([key]) => !["endedAt", "result", "cancellationReason"].includes(key),
      ),
    );
    running.state = "RUNNING";

    expectValid(schema.attempt, running);
    expectValid(schema.attempt, completed);
    expectValid(schema.attempt, cancelled);
    expectInvalid(schema.attempt, { ...running, result: "PASS" });
    expectInvalid(schema.attempt, cancelledWithoutReason);
    expectInvalid(schema.attempt, { ...completed, cancellationReason: "orphan" });
    expectInvalid(schema.attempt, planResult);
  });

  it("makes result commands CAS-only and rejects caller-selected Attempt/Observation memberships", async () => {
    const command = await fixture("positive/plan-item-result-clean-pass-command.valid.json");
    const zeroObservations = await fixture(
      "negative/plan-item-result-clean-pass-zero-observations.invalid.json",
    );
    expectValid(schema.resultCommand, command);
    expectInvalid(schema.resultCommand, zeroObservations);
    for (const forbidden of ["consideredAttemptRefs", "consideredObservationRefs"]) {
      expect(command).not.toHaveProperty(forbidden);
      expectInvalid(schema.resultCommand, { ...command, [forbidden]: [] });
    }

    const cleanSnapshot = {
      attemptSetHash: command.expectedAttemptSetHash,
      maximumAttemptNo: 1,
      observationSetHash: command.expectedObservationSetHash,
      observationCount: 1,
    };
    expect(commandCasMatches(command, cleanSnapshot)).toBe(true);
    const omitsEarlier = await fixture(
      "negative/plan-item-result-command-omits-earlier-attempt.semantic.json",
    );
    const staleAfterRepeat = await fixture(
      "negative/plan-item-result-command-stale-after-late-repeat.semantic.json",
    );
    const currentTwoAttemptSnapshot = {
      attemptSetHash: "sha256:6868686868686868686868686868686868686868686868686868686868686869",
      maximumAttemptNo: 2,
      observationSetHash: "sha256:6969696969696969696969696969696969696969696969696969696969696968",
      observationCount: 2,
    };
    expect(commandCasMatches(omitsEarlier, currentTwoAttemptSnapshot)).toBe(false);
    expect(commandCasMatches(staleAfterRepeat, currentTwoAttemptSnapshot)).toBe(false);
  });

  it("requires a current-leaf POSITIVE Observation on an exact PASS Attempt", async () => {
    const passAttempt = await fixture("positive/manual-attempt-clean-pass.valid.json");
    const failedAttempt = await fixture("positive/manual-attempt.valid.json");
    const positive = await fixture("positive/observation-clean-pass.valid.json");
    const correction = await fixture("positive/observation-clean-pass-correction.valid.json");
    const informational = await fixture(
      "negative/observation-informational-pass-attempt.semantic.json",
    );
    const positiveOnFailed = await fixture(
      "negative/observation-positive-on-failed-attempt.semantic.json",
    );
    const cleanResult = await fixture("positive/plan-item-result-clean-pass.valid.json");
    const informationalResult = await fixture(
      "negative/plan-item-result-pass-informational-only.semantic.json",
    );
    const nonPassAttemptResult = await fixture(
      "negative/plan-item-result-pass-nonpass-attempt.semantic.json",
    );
    const staleObservationResult = await fixture(
      "negative/plan-item-result-pass-stale-observation.semantic.json",
    );

    expectValid(schema.observation, positive);
    expectValid(schema.observation, correction);
    expect(
      cleanPassSemantics(cleanResult, [passAttempt], [positive], new Set([positive.observationId])),
    ).toBe(true);
    expect(
      cleanPassSemantics(
        informationalResult,
        [passAttempt],
        [informational],
        new Set([informational.observationId]),
      ),
    ).toBe(false);
    expect(
      cleanPassSemantics(
        nonPassAttemptResult,
        [failedAttempt],
        [positiveOnFailed],
        new Set([positiveOnFailed.observationId]),
      ),
    ).toBe(false);
    expect(
      cleanPassSemantics(
        staleObservationResult,
        [passAttempt],
        [positive, correction],
        new Set([correction.observationId]),
      ),
    ).toBe(false);
    expect(
      cleanPassSemantics(
        cleanResult,
        [passAttempt],
        [{ ...positive, attemptId: "00000000-0000-4000-8000-000000000099" }],
        new Set([positive.observationId]),
      ),
    ).toBe(false);
  });

  it("keeps initial/correction lineages explicit for results and Observations", async () => {
    const initial = await fixture("positive/plan-item-result-initial-predecessor.valid.json");
    const initialWithReason = await fixture(
      "negative/plan-item-result-initial-with-correction-reason.invalid.json",
    );
    const correctionWithoutReason = await fixture(
      "negative/plan-item-result-correction-without-reason.invalid.json",
    );
    const observation = await fixture("positive/observation-clean-pass.valid.json");
    const correction = await fixture("positive/observation-clean-pass-correction.valid.json");

    expectValid(schema.resultPredecessor, initial);
    expectInvalid(schema.resultPredecessor, initialWithReason);
    expectInvalid(schema.resultPredecessor, correctionWithoutReason);
    expectValid(schema.observation, observation);
    expectValid(schema.observation, correction);
    expectInvalid(schema.observation, {
      ...correction,
      correctionReason: undefined,
    });
    expectInvalid(schema.observation, {
      ...observation,
      correctionReason: "orphan reason",
    });
  });

  it("implements the closed executed-versus-waived and flaky result table", async () => {
    const executed = await fixture("positive/plan-item-result-clean-pass.valid.json");
    const waived = await fixture("positive/plan-item-result-not-run-waived.valid.json");
    const flakyPass = await fixture("positive/plan-item-result-flaky-pass-command.valid.json");
    const inconclusive = await fixture(
      "positive/plan-item-result-inconclusive-without-flaky-basis.valid.json",
    );
    const passWithoutBasis = await fixture(
      "negative/plan-item-result-flaky-pass-without-disposition-basis.invalid.json",
    );
    const inconclusiveWithBasis = await fixture(
      "negative/plan-item-result-inconclusive-with-flaky-basis.invalid.json",
    );
    const failWithFlag = await fixture(
      "negative/plan-item-result-fail-with-flaky-flag.invalid.json",
    );

    expectValid(schema.result, executed);
    expectValid(schema.result, waived);
    expectValid(schema.resultCommand, flakyPass);
    expectValid(schema.resultCommand, inconclusive);
    expectInvalid(schema.resultCommand, passWithoutBasis);
    expectInvalid(schema.resultCommand, inconclusiveWithBasis);
    expectInvalid(schema.resultCommand, failWithFlag);
    expectInvalid(schema.resultCommand, {
      ...flakyPass,
      result: "BLOCKED",
    });
    expectInvalid(schema.resultCommand, {
      ...flakyPass,
      result: "NOT_RUN",
      expectedMaximumAttemptNo: 0,
      expectedObservationCount: 0,
      artifactIds: [],
    });
    expectInvalid(schema.resultCommand, {
      ...(await fixture("positive/plan-item-result-clean-pass-command.valid.json")),
      flakyDispositionBasis: flakyPass.flakyDispositionBasis,
    });

    const unrelated = await fixture(
      "negative/plan-item-result-flaky-pass-unrelated-finding.semantic.json",
    );
    const wrongAttempt = await fixture(
      "negative/plan-item-result-flaky-pass-wrong-failed-attempt.semantic.json",
    );
    const exactBasis = flakyPass.flakyDispositionBasis as JsonObject;
    expect(flakyBasisMatches(flakyPass, exactBasis)).toBe(true);
    expect(flakyBasisMatches(unrelated, exactBasis)).toBe(false);
    expect(flakyBasisMatches(wrongAttempt, exactBasis)).toBe(false);
  });
});
