import { describe, expect, it } from "vitest";

import { GitLabTransportError } from "../../../packages/connector-gitlab/src/index.ts";
import { JiraTransportError } from "../../../packages/connector-jira/src/index.ts";
import {
  classifyPilotFailure,
  classifyPilotHttpFailure,
  decidePilotRetry,
  type PilotEffectCertainty,
  type PilotRetryInput,
} from "../../../packages/runtime-composition/src/pilot/retry-policy.ts";

const input: PilotRetryInput = {
  operation: "READ",
  certainty: "NOT_DISPATCHED",
  attempt: 1,
  firstAttemptAt: "2026-09-04T10:00:00Z",
  now: "2026-09-04T10:00:00Z",
  failure: classifyPilotHttpFailure(503),
  policy: {
    maximumAttempts: 4,
    minimumBackoffMs: 1000,
    maximumBackoffMs: 30_000,
    maximumElapsedMs: 300_000,
  },
};
describe("008 bounded classified retry", () => {
  it("classifies only typed adapter failures, preserving auth and business stops", () => {
    for (const status of [400, 401, 403, 404, 409, 412, 422, 501]) {
      for (const error of [
        new GitLabTransportError(`GITLAB_HTTP_${status}`, status),
        new JiraTransportError(`JIRA_HTTP_${status}`, status),
        new Error(`MATTERMOST_HTTP_${status}`),
      ]) {
        expect(decidePilotRetry({ ...input, failure: classifyPilotFailure(error) }).action).toBe(
          "STOP",
        );
      }
    }
    for (const error of [
      new TypeError("fetch failed"),
      new Error("ASSERTION_FAILED"),
      new Error("TEST_FAILED"),
      new GitLabTransportError("GITLAB_RESPONSE_JSON_INVALID", 503),
    ])
      expect(classifyPilotFailure(error).kind).toBe("UNKNOWN");
  });
  it("bounds attempts, elapsed window and delay without shortening server hints", () => {
    for (const status of [408, 429, 500, 502, 503, 504])
      expect(
        decidePilotRetry({ ...input, failure: classifyPilotHttpFailure(status) }),
      ).toMatchObject({ action: "RETRY_ORIGINAL", delayMs: 1000 });
    expect(
      decidePilotRetry({ ...input, attempt: 3, failure: classifyPilotHttpFailure(429, 1) }),
    ).toMatchObject({ delayMs: 4000 });
    expect(
      decidePilotRetry({ ...input, failure: classifyPilotHttpFailure(429, 17) }),
    ).toMatchObject({ delayMs: 17_000, nextEligibleAt: "2026-09-04T10:00:17.000Z" });
    expect(
      decidePilotRetry({ ...input, failure: classifyPilotHttpFailure(429, 60) }),
    ).toMatchObject({ action: "STOP", reasonCode: "RETRY_AFTER_EXCEEDS_BUDGET" });
    expect(decidePilotRetry({ ...input, attempt: 4 })).toMatchObject({
      action: "STOP",
      reasonCode: "RETRY_BUDGET_EXHAUSTED",
    });
    expect(decidePilotRetry({ ...input, now: "2026-09-04T10:04:59Z" })).toMatchObject({
      action: "STOP",
      reasonCode: "RETRY_WINDOW_EXHAUSTED",
    });
    for (const hint of [NaN, Infinity, -1, Number.MAX_VALUE])
      expect(
        decidePilotRetry({ ...input, failure: classifyPilotHttpFailure(429, hint) }).action,
      ).toBe("STOP");
  });
  it("never converts uncertain writes into retries, including 429 and auth failures", () => {
    const states = {
      POSSIBLY_APPLIED: "RECONCILE_ONLY",
      CONFIRMED_APPLIED: "CONFIRM_OBSERVED",
      DIVERGENT: "CONTROLLED_ACTION",
      UNRESOLVED: "QUARANTINE",
    } as const;
    for (const [certainty, action] of Object.entries(states))
      for (const status of [401, 403, 429, 500, 503])
        expect(
          decidePilotRetry({
            ...input,
            operation: "WRITE",
            certainty: certainty as PilotEffectCertainty,
            failure: classifyPilotHttpFailure(status),
          }).action,
        ).toBe(action);
    expect(
      decidePilotRetry({ ...input, operation: "WRITE", certainty: "CONFIRMED_NOT_APPLIED" }).action,
    ).toBe("RETRY_ORIGINAL");
  });
  it("rejects corrupt persisted attempt and policy inputs", () => {
    for (const attempt of [0, -1, NaN, Infinity, 1.5])
      expect(() => decidePilotRetry({ ...input, attempt })).toThrow("PILOT_RETRY_INPUT_INVALID");
    expect(() => decidePilotRetry({ ...input, now: "2026-09-03T00:00:00Z" })).toThrow();
    expect(() =>
      decidePilotRetry({ ...input, policy: { ...input.policy, maximumAttempts: 1000 } }),
    ).toThrow();
  });
});
