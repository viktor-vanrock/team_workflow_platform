import {
  assertQaVerifiedHuman,
  qaAggregateSnapshotHash,
  QaDomainError,
  qaScopeFromContext,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import {
  assertQaProjectContextScope,
  type QaExternalImmutableRef,
  type QaProjectContext,
} from "../domain/qa-project-context.ts";
import {
  assertQaDorSemanticInput,
  type QaDorSemanticInput,
  type QaPreviousSessionRef,
  type QaResponseChannelResolution,
} from "../domain/qa-request-input-revision.ts";
import { type QaRequestKind, qaRequestKinds } from "../manifest.ts";
import type {
  QaOperationalRequestCreateInput,
  QaOperationalRequestCreateTarget,
} from "./operational-request-create-port.ts";

export interface QaIntakePayload extends QaDorSemanticInput {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly requestKind: QaRequestKind;
  readonly requestedClassificationKey: string;
}

export interface QaConfirmedDraft {
  readonly id: string;
  readonly version: number;
  readonly contentHash: `sha256:${string}`;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definitionRef: Readonly<{ key: "qa.validation"; version: "1.0.0" }>;
  readonly state: "CONFIRMED";
  readonly requester: ReturnType<typeof assertQaVerifiedHuman>;
  readonly payload: QaIntakePayload;
  readonly authoritativeClassificationKey: string;
}

export interface QaResponseChannelResolver {
  resolve(
    input: Readonly<{
      context: QaWorkspaceContext;
      requester: ReturnType<typeof assertQaVerifiedHuman>;
      allowedKinds: readonly ["PLATFORM_WEB"];
      evaluatedAt: string;
    }>,
  ): Promise<QaResponseChannelResolution>;
}

export interface ValidatedQaIntake {
  readonly draft: QaConfirmedDraft;
  readonly context: QaProjectContext;
  readonly responseChannelResolution: QaResponseChannelResolution;
  readonly semanticInput: QaDorSemanticInput;
  readonly blockersDeclared: boolean;
  readonly dependenciesDeclared: boolean;
  readonly target: QaOperationalRequestCreateTarget;
  readonly createInput: QaOperationalRequestCreateInput;
}

const forbiddenKey =
  /password|token|cookie|credential|secret|authorization|providerUrl|endpoint|locator/iu;
const forbiddenValue = /(?:secretref:\/\/|bearer\s+|https?:\/\/[^\s/@]+:[^\s/@]+@|s3:\/\/)/iu;
function assertSecretFree(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    if (forbiddenValue.test(value)) throw new QaDomainError("QA_SECRET_MATERIAL_FORBIDDEN", path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      assertSecretFree(child, `${path}[${index}]`);
    });
    return;
  }
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key))
        throw new QaDomainError("QA_SECRET_FIELD_FORBIDDEN", `${path}.${key}`);
      assertSecretFree(child, `${path}.${key}`);
    }
}

function semanticFrom(payload: QaIntakePayload): QaDorSemanticInput {
  const semantic = { ...payload } as Record<string, unknown>;
  delete semantic.schemaVersion;
  delete semantic.title;
  delete semantic.requestKind;
  delete semantic.requestedClassificationKey;
  return semantic as QaDorSemanticInput;
}

function assertRetestLineage(previous: QaPreviousSessionRef | undefined): void {
  if (previous === undefined) return;
  if (previous.kind !== "EXTERNAL_HISTORICAL")
    throw new QaDomainError("QA_NATIVE_SESSION_LINEAGE_NOT_INSTALLED");
  const ref: QaExternalImmutableRef = previous.historicalSessionRef;
  if (
    ref.kind.length === 0 ||
    ref.id.length === 0 ||
    ref.version.length === 0 ||
    !ref.contentHash.startsWith("sha256:")
  )
    throw new QaDomainError("QA_RETEST_LINEAGE_INVALID");
}

export async function validateConfirmedQaIntake(
  input: Readonly<{
    context: QaWorkspaceContext;
    draft: QaConfirmedDraft;
    projectContext: QaProjectContext;
    responseChannels: QaResponseChannelResolver;
    bindingRef: Readonly<{ id: string; version: number }>;
    evaluatedAt: string;
  }>,
): Promise<ValidatedQaIntake> {
  const scope = qaScopeFromContext(input.context);
  const actor = assertQaVerifiedHuman(input.context);
  assertQaProjectContextScope(input.projectContext, scope);
  if (
    input.draft.state !== "CONFIRMED" ||
    input.draft.workspaceId !== scope.workspaceId ||
    input.draft.projectId !== scope.projectId ||
    input.draft.definitionRef.key !== "qa.validation" ||
    input.draft.definitionRef.version !== "1.0.0" ||
    input.draft.requester.principalId !== actor.principalId ||
    input.draft.payload.title.trim().length === 0 ||
    !qaRequestKinds.includes(input.draft.payload.requestKind) ||
    input.draft.payload.requestedClassificationKey !== input.draft.authoritativeClassificationKey ||
    input.bindingRef.id.length === 0 ||
    input.bindingRef.version < 1
  )
    throw new QaDomainError("QA_CONFIRMED_DRAFT_STRUCTURAL_INVALID");
  assertSecretFree(input.draft.payload);
  const semanticInput = semanticFrom(input.draft.payload);
  assertQaDorSemanticInput(semanticInput, input.draft.payload.requestKind);
  assertRetestLineage(semanticInput.previousSessionRef);
  const responseChannelResolution = await input.responseChannels.resolve({
    context: input.context,
    requester: input.draft.requester,
    allowedKinds: input.projectContext.allowedResponseChannelKinds,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    responseChannelResolution.requesterPrincipal.principalId !== input.draft.requester.principalId
  )
    throw new QaDomainError("QA_RESPONSE_CHANNEL_REQUESTER_MISMATCH");
  const target = Object.freeze({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    entityKind: "REQUEST" as const,
    authorityScopeKey: input.projectContext.requestAuthorityRequirementKey,
    naturalKey: `qa-${input.draft.id}`,
  });
  const createInput = Object.freeze({
    sourceDraftId: input.draft.id,
    workTypeKey: "qa.validation" as const,
    workTypeVersion: "1.0.0" as const,
    requestKind: input.draft.payload.requestKind,
    summary: input.draft.payload.title,
    ...(semanticInput.goal === undefined ? {} : { description: semanticInput.goal }),
    ...(semanticInput.acceptanceOutcome === undefined
      ? {}
      : { acceptanceOutcome: semanticInput.acceptanceOutcome }),
    ...(semanticInput.sourceRefs === undefined ? {} : { sourceRefs: semanticInput.sourceRefs }),
    requestedNormalizedStatus: "NEW" as const,
    dataClassificationKey: input.draft.authoritativeClassificationKey,
  });
  return Object.freeze({
    draft: input.draft,
    context: input.projectContext,
    responseChannelResolution,
    semanticInput,
    blockersDeclared: Object.hasOwn(input.draft.payload, "blockers"),
    dependenciesDeclared: Object.hasOwn(input.draft.payload, "dependencies"),
    target,
    createInput,
  });
}

export function externalRequestRefFromResult(
  result: Readonly<{
    externalEntityId: string;
    externalVersion: string;
    rawExternalState: string;
    normalizedStatus: string;
    naturalKey: string;
  }>,
): QaExternalImmutableRef {
  return Object.freeze({
    kind: "request",
    id: result.externalEntityId,
    version: result.externalVersion,
    contentHash: qaAggregateSnapshotHash(result as never),
  });
}
