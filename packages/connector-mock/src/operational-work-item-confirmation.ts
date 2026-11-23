import {
  OperationalConnectorError,
  type OperationalDefectCreateResult,
  type OperationalRequestCreateResult,
  type OperationalRequestTransitionResult,
  type OperationalWorkItemTarget,
} from "@awp/connector-sdk";

export interface MockOperationalProviderResult extends OperationalRequestCreateResult {
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}

export interface MockOperationalTransitionProviderResult extends OperationalRequestTransitionResult {
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}

export interface MockOperationalDefectProviderResult extends OperationalDefectCreateResult {
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}

export function normalizeOperationalRequestCreateResult(
  target: OperationalWorkItemTarget,
  profileRef: Readonly<{ id: string; version: number }>,
  effectIdempotencyKey: string,
  result: MockOperationalProviderResult,
): OperationalRequestCreateResult {
  if (
    result.operation !== "request.create" ||
    result.entityKind !== "REQUEST" ||
    result.normalizedStatus !== "NEW" ||
    result.effectId !== effectIdempotencyKey ||
    result.scope.workspaceId !== target.workspaceId ||
    result.scope.projectId !== target.projectId
  )
    throw new OperationalConnectorError("RESULT_SCOPE_MISMATCH", false);
  if (result.profileRef.id !== profileRef.id || result.profileRef.version !== profileRef.version) {
    throw new OperationalConnectorError("RESULT_PROFILE_MISMATCH", false);
  }
  if (
    result.externalEntityId.length === 0 ||
    result.externalDisplayKey.length === 0 ||
    result.externalVersion.length === 0 ||
    result.rawExternalState.length === 0 ||
    result.naturalKey.length < 8 ||
    Number.isNaN(Date.parse(result.observedAt))
  )
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  return Object.freeze({
    operation: "request.create",
    entityKind: "REQUEST",
    externalEntityId: result.externalEntityId,
    externalDisplayKey: result.externalDisplayKey,
    externalVersion: result.externalVersion,
    rawExternalState: result.rawExternalState,
    normalizedStatus: "NEW",
    naturalKey: result.naturalKey,
    effectId: result.effectId,
    observedAt: result.observedAt,
  });
}

export async function confirmOperationalRequestCreate(
  input: Readonly<{
    target: OperationalWorkItemTarget;
    profileRef: Readonly<{ id: string; version: number }>;
    effectIdempotencyKey: string;
    readByEffect: (
      effectIdempotencyKey: string,
    ) => Promise<MockOperationalProviderResult | undefined>;
  }>,
): Promise<OperationalRequestCreateResult | undefined> {
  const found = await input.readByEffect(input.effectIdempotencyKey);
  return found === undefined
    ? undefined
    : normalizeOperationalRequestCreateResult(
        input.target,
        input.profileRef,
        input.effectIdempotencyKey,
        found,
      );
}

export function normalizeOperationalRequestTransitionResult(
  target: OperationalWorkItemTarget,
  profileRef: Readonly<{ id: string; version: number }>,
  effectIdempotencyKey: string,
  result: MockOperationalTransitionProviderResult,
): OperationalRequestTransitionResult {
  if (
    result.operation !== "request.transition" ||
    result.entityKind !== "REQUEST" ||
    (result.normalizedStatus !== "READY" && result.normalizedStatus !== "DONE") ||
    result.effectId !== effectIdempotencyKey ||
    result.scope.workspaceId !== target.workspaceId ||
    result.scope.projectId !== target.projectId
  )
    throw new OperationalConnectorError("RESULT_SCOPE_MISMATCH", false);
  if (result.profileRef.id !== profileRef.id || result.profileRef.version !== profileRef.version)
    throw new OperationalConnectorError("RESULT_PROFILE_MISMATCH", false);
  if (
    result.normalizedStatus === "DONE" &&
    (result.completionSummaryReceipt === undefined ||
      !result.completionSummaryReceipt.contentHash.startsWith("sha256:"))
  )
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  return Object.freeze({
    operation: "request.transition",
    entityKind: "REQUEST",
    externalEntityId: result.externalEntityId,
    externalDisplayKey: result.externalDisplayKey,
    externalVersion: result.externalVersion,
    rawExternalState: result.rawExternalState,
    normalizedStatus: result.normalizedStatus,
    naturalKey: result.naturalKey,
    effectId: result.effectId,
    observedAt: result.observedAt,
    ...(result.completionSummaryReceipt === undefined
      ? {}
      : {
          completionSummaryReceipt: Object.freeze(structuredClone(result.completionSummaryReceipt)),
        }),
  });
}

export async function confirmOperationalRequestTransition(
  input: Readonly<{
    target: OperationalWorkItemTarget;
    profileRef: Readonly<{ id: string; version: number }>;
    effectIdempotencyKey: string;
    readByEffect: (
      effectIdempotencyKey: string,
    ) => Promise<MockOperationalTransitionProviderResult | undefined>;
  }>,
): Promise<OperationalRequestTransitionResult | undefined> {
  const found = await input.readByEffect(input.effectIdempotencyKey);
  return found
    ? normalizeOperationalRequestTransitionResult(
        input.target,
        input.profileRef,
        input.effectIdempotencyKey,
        found,
      )
    : undefined;
}

export function normalizeOperationalDefectCreateResult(
  target: OperationalWorkItemTarget,
  profileRef: Readonly<{ id: string; version: number }>,
  effectIdempotencyKey: string,
  result: MockOperationalDefectProviderResult,
): OperationalDefectCreateResult {
  if (
    target.entityKind !== "DEFECT" ||
    result.operation !== "defect.create" ||
    result.entityKind !== "DEFECT" ||
    result.normalizedStatus !== "NEW" ||
    result.effectId !== effectIdempotencyKey ||
    result.scope.workspaceId !== target.workspaceId ||
    result.scope.projectId !== target.projectId
  )
    throw new OperationalConnectorError("RESULT_SCOPE_MISMATCH", false);
  if (result.profileRef.id !== profileRef.id || result.profileRef.version !== profileRef.version)
    throw new OperationalConnectorError("RESULT_PROFILE_MISMATCH", false);
  if (
    !result.externalEntityId ||
    !result.externalDisplayKey ||
    !result.externalVersion ||
    !result.rawExternalState ||
    !result.naturalKey ||
    Number.isNaN(Date.parse(result.observedAt))
  )
    throw new OperationalConnectorError("SCHEMA_DRIFT", false);
  return Object.freeze({
    operation: "defect.create",
    entityKind: "DEFECT",
    externalEntityId: result.externalEntityId,
    externalDisplayKey: result.externalDisplayKey,
    externalVersion: result.externalVersion,
    rawExternalState: result.rawExternalState,
    normalizedStatus: "NEW",
    naturalKey: result.naturalKey,
    effectId: result.effectId,
    observedAt: result.observedAt,
  });
}

export async function confirmOperationalDefectCreate(
  input: Readonly<{
    target: OperationalWorkItemTarget;
    profileRef: Readonly<{ id: string; version: number }>;
    effectIdempotencyKey: string;
    readByEffect: (
      effectIdempotencyKey: string,
    ) => Promise<MockOperationalDefectProviderResult | undefined>;
  }>,
): Promise<OperationalDefectCreateResult | undefined> {
  const found = await input.readByEffect(input.effectIdempotencyKey);
  return found
    ? normalizeOperationalDefectCreateResult(
        input.target,
        input.profileRef,
        input.effectIdempotencyKey,
        found,
      )
    : undefined;
}
