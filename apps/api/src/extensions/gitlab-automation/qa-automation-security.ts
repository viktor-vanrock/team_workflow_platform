import { ForbiddenException } from "@nestjs/common";

import type { QaAutomationTarget, QaHumanActor } from "@awp/competency-qa/node";

function object(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ForbiddenException(code);
  return value as Readonly<Record<string, unknown>>;
}

function closed(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ForbiddenException(`${code}:${unknown.sort().join(",")}`);
}

function unsafe(value: unknown): boolean {
  if (typeof value === "string")
    return (
      /(?:^|[._:/-])(?:deploy|deployment|production|prod)(?:$|[._:/-])/iu.test(value) ||
      /[\r\n;&|`$<>]/u.test(value) ||
      /^(?:secretref|https?):\/\//iu.test(value)
    );
  if (Array.isArray(value)) return value.some(unsafe);
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value as Readonly<Record<string, unknown>>).some(unsafe)
  );
}

export function assertQaAutomationHuman(
  actor: Readonly<{ kind: string }>,
): asserts actor is QaHumanActor {
  if (actor.kind !== "HUMAN") throw new ForbiddenException("QA_AUTOMATION_VERIFIED_HUMAN_REQUIRED");
}

export function validateCreateAutomatedSessionBody(value: unknown) {
  const body = object(value, "QA_AUTOMATED_SESSION_BODY_INVALID");
  closed(
    body,
    [
      "workItemId",
      "suiteBindingRef",
      "target",
      "environmentRef",
      "parameters",
      "browser",
      "replacesSession",
    ],
    "QA_AUTOMATED_SESSION_FIELD_FORBIDDEN",
  );
  const suite = object(body.suiteBindingRef, "QA_AUTOMATED_SESSION_SUITE_REF_INVALID");
  closed(suite, ["id", "version"], "QA_AUTOMATED_SESSION_SUITE_REF_FIELD_FORBIDDEN");
  const target = object(body.target, "QA_AUTOMATED_SESSION_TARGET_INVALID");
  let automationTarget: QaAutomationTarget;
  if (target.type === "MERGE_REQUEST") {
    closed(
      target,
      ["type", "mergeRequestRef", "commitSha"],
      "QA_AUTOMATED_SESSION_TARGET_FIELD_FORBIDDEN",
    );
    if (typeof target.mergeRequestRef !== "string" || typeof target.commitSha !== "string")
      throw new ForbiddenException("QA_AUTOMATED_SESSION_TARGET_SELECTOR_INVALID");
    automationTarget = Object.freeze({
      type: "MERGE_REQUEST",
      mergeRequestRef: target.mergeRequestRef,
      commitSha: target.commitSha,
    });
  } else if (target.type === "COMMIT") {
    closed(target, ["type", "commitSha"], "QA_AUTOMATED_SESSION_TARGET_FIELD_FORBIDDEN");
    if (typeof target.commitSha !== "string")
      throw new ForbiddenException("QA_AUTOMATED_SESSION_TARGET_SELECTOR_INVALID");
    automationTarget = Object.freeze({ type: "COMMIT", commitSha: target.commitSha });
  } else if (target.type === "BUILD") {
    closed(
      target,
      ["type", "buildRef", "commitSha"],
      "QA_AUTOMATED_SESSION_TARGET_FIELD_FORBIDDEN",
    );
    if (typeof target.buildRef !== "string" || typeof target.commitSha !== "string")
      throw new ForbiddenException("QA_AUTOMATED_SESSION_TARGET_SELECTOR_INVALID");
    automationTarget = Object.freeze({
      type: "BUILD",
      buildRef: target.buildRef,
      commitSha: target.commitSha,
    });
  } else throw new ForbiddenException("QA_AUTOMATED_SESSION_TARGET_TYPE_FORBIDDEN");
  const replaces =
    body.replacesSession === undefined
      ? undefined
      : object(body.replacesSession, "QA_AUTOMATED_SESSION_REPLACEMENT_INVALID");
  if (replaces)
    closed(
      replaces,
      ["testSessionId", "reason", "priorTargetSnapshotHash"],
      "QA_AUTOMATED_SESSION_REPLACEMENT_FIELD_FORBIDDEN",
    );
  if (unsafe(target) || unsafe(body.environmentRef) || unsafe(body.parameters))
    throw new ForbiddenException("QA_AUTOMATED_SESSION_PRODUCTION_DEPLOY_OR_INPUT_FORBIDDEN");
  if (
    typeof body.workItemId !== "string" ||
    typeof suite.id !== "string" ||
    !Number.isInteger(suite.version) ||
    typeof body.environmentRef !== "string" ||
    body.parameters === null ||
    typeof body.parameters !== "object" ||
    Array.isArray(body.parameters)
  ) {
    throw new ForbiddenException("QA_AUTOMATED_SESSION_SELECTOR_INVALID");
  }
  return Object.freeze({
    workItemId: body.workItemId,
    suiteBindingRef: Object.freeze({ id: suite.id, version: Number(suite.version) }),
    target: automationTarget,
    environmentRef: body.environmentRef,
    parameters: Object.freeze({ ...(body.parameters as Readonly<Record<string, unknown>>) }),
    ...(typeof body.browser === "string"
      ? { browser: body.browser as "chromium" | "firefox" | "webkit" }
      : {}),
    ...(replaces === undefined ? {} : { replacesSession: Object.freeze({ ...replaces }) }),
  });
}

export function validateCreateAutomationSuiteBody(value: unknown) {
  const body = object(value, "QA_AUTOMATION_SUITE_BODY_INVALID");
  closed(
    body,
    [
      "suiteKey",
      "ownerPrincipalId",
      "suiteDefinition",
      "logicalExecutionContract",
      "allowedTargetTypes",
      "allowedEnvironmentRefs",
      "parameterSchemaRef",
      "resultSchemaRef",
      "artifactPolicyRef",
      "artifactPolicyHash",
      "retryPolicyRef",
      "retryPolicyHash",
      "quarantinePolicyRef",
      "quarantinePolicyHash",
    ],
    "QA_AUTOMATION_SUITE_FIELD_FORBIDDEN",
  );
  if (unsafe(body.allowedEnvironmentRefs) || unsafe(body.logicalExecutionContract))
    throw new ForbiddenException("QA_AUTOMATION_SUITE_PRODUCTION_OR_DEPLOY_FORBIDDEN");
  return Object.freeze({ ...body });
}

export async function executeAfterQaAutomationGate<T>(
  input: Readonly<{
    authorize: () => Promise<
      Readonly<{ actor: Readonly<{ kind: string }>; workspaceId: string; projectId: string }>
    >;
    workspaceId: string;
    projectId: string;
    body: unknown;
    validate: (value: unknown) => unknown;
    invoke: () => Promise<T>;
  }>,
): Promise<T> {
  const authorization = await input.authorize();
  assertQaAutomationHuman(authorization.actor);
  if (
    authorization.workspaceId !== input.workspaceId ||
    authorization.projectId !== input.projectId
  )
    throw new ForbiddenException("QA_AUTOMATION_SCOPE_DENIED");
  input.validate(input.body);
  return await input.invoke();
}
