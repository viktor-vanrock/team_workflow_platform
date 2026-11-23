import { describe, expect, it } from "vitest";

import {
  executeAfterQaAutomationGate,
  validateCreateAutomatedSessionBody,
} from "../../../../apps/api/src/extensions/gitlab-automation/qa-automation-security.ts";

const workspaceId = "workspace-005";
const projectId = "project-005";
const suiteBindingId = "11111111-1111-4111-8111-111111111111";

const allowed = Object.freeze({
  workItemId: "work-item-005",
  suiteBindingRef: Object.freeze({ id: suiteBindingId, version: 3 }),
  target: Object.freeze({
    type: "MERGE_REQUEST" as const,
    mergeRequestRef: "!42",
    commitSha: "a".repeat(40),
  }),
  environmentRef: "test@7",
  parameters: Object.freeze({ shard: 2, locale: "en-US" }),
  browser: "chromium" as const,
});

type Authorization = Readonly<{
  actor: Readonly<{ kind: string }>;
  workspaceId: string;
  projectId: string;
}>;

function authority(value: unknown): ReturnType<typeof validateCreateAutomatedSessionBody> {
  const body = validateCreateAutomatedSessionBody(value);
  if (body.suiteBindingRef.id !== suiteBindingId || body.suiteBindingRef.version !== 3) {
    throw new Error("QA_AUTOMATED_SESSION_SUITE_ALLOWLIST_DENIED");
  }
  if (
    body.target.type !== "MERGE_REQUEST" ||
    body.target.mergeRequestRef !== "!42" ||
    body.target.commitSha !== "a".repeat(40)
  ) {
    throw new Error("QA_AUTOMATED_SESSION_REF_ALLOWLIST_DENIED");
  }
  if (body.environmentRef !== "test@7")
    throw new Error("QA_AUTOMATED_SESSION_ENVIRONMENT_ALLOWLIST_DENIED");
  if (
    body.parameters.shard !== 2 ||
    body.parameters.locale !== "en-US" ||
    Object.keys(body.parameters).length !== 2
  ) {
    throw new Error("QA_AUTOMATED_SESSION_PARAMETER_ALLOWLIST_DENIED");
  }
  return body;
}

async function exercise(
  input: Readonly<{
    body?: unknown;
    authorize?: () => Promise<Authorization>;
  }> = {},
) {
  let secretResolutions = 0;
  let triggerCalls = 0;
  const invoke = async () => {
    secretResolutions += 1;
    triggerCalls += 1;
    return Object.freeze({ status: "READY" });
  };
  const operation = executeAfterQaAutomationGate({
    workspaceId,
    projectId,
    body: input.body ?? allowed,
    authorize:
      input.authorize ??
      (async () =>
        Object.freeze({ actor: Object.freeze({ kind: "HUMAN" }), workspaceId, projectId })),
    validate: authority,
    invoke,
  });
  return Object.freeze({
    operation,
    counts: () => Object.freeze({ secretResolutions, triggerCalls }),
  });
}

describe("US1 automated Session authorization boundary", () => {
  it.each([
    [
      "RBAC",
      allowed,
      async () => {
        throw new Error("QA_PERMISSION_DENIED");
      },
    ],
    [
      "entitlement",
      allowed,
      async () => {
        throw new Error("QA_ENTITLEMENT_DENIED");
      },
    ],
    [
      "cross-project",
      allowed,
      async () =>
        Object.freeze({
          actor: Object.freeze({ kind: "HUMAN" }),
          workspaceId,
          projectId: "foreign-project",
        }),
    ],
    [
      "non-HUMAN",
      allowed,
      async () =>
        Object.freeze({ actor: Object.freeze({ kind: "SERVICE" }), workspaceId, projectId }),
    ],
    ["autonomous-origin", Object.freeze({ ...allowed, originKind: "AGENT" }), undefined],
    [
      "suite",
      Object.freeze({
        ...allowed,
        suiteBindingRef: Object.freeze({ id: "22222222-2222-4222-8222-222222222222", version: 3 }),
      }),
      undefined,
    ],
    [
      "ref",
      Object.freeze({
        ...allowed,
        target: Object.freeze({ ...allowed.target, commitSha: "b".repeat(40) }),
      }),
      undefined,
    ],
    ["environment", Object.freeze({ ...allowed, environmentRef: "test@8" }), undefined],
    [
      "parameter",
      Object.freeze({ ...allowed, parameters: Object.freeze({ shard: 99, locale: "en-US" }) }),
      undefined,
    ],
    ["production", Object.freeze({ ...allowed, environmentRef: "production@1" }), undefined],
    [
      "deploy",
      Object.freeze({
        ...allowed,
        parameters: Object.freeze({ shard: 2, locale: "en-US", action: "deploy" }),
      }),
      undefined,
    ],
  ] as const)("denies %s before secret resolution or trigger", async (_name, body, authorize) => {
    const attempt = await exercise({ body, ...(authorize === undefined ? {} : { authorize }) });
    await expect(attempt.operation).rejects.toThrow();
    expect(attempt.counts()).toEqual({ secretResolutions: 0, triggerCalls: 0 });
  });

  it("allows the exact HUMAN-authorized bounded request to cross the effect boundary once", async () => {
    const attempt = await exercise();
    await expect(attempt.operation).resolves.toEqual({ status: "READY" });
    expect(attempt.counts()).toEqual({ secretResolutions: 1, triggerCalls: 1 });
  });
});
