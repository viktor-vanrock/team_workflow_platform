import {
  canonicalize,
  canonicalSort,
  type JsonValue,
  sha256,
  type Sha256Digest,
} from "@awp/platform-contracts";

import { QaDomainError, type QaScope } from "../domain/primitives.ts";

export const qaQueueSourceTypes = Object.freeze([
  "QA_INPUT",
  "QA_READINESS",
  "QA_REQUIRED_SESSION_PLAN",
  "QA_SESSION",
  "QA_AUTOMATION",
  "QA_SIGNED_VERDICT",
] as const);
export type QaQueueSourceType = (typeof qaQueueSourceTypes)[number];

export const qaQueueFactKinds = Object.freeze([
  "READINESS",
  "SESSION",
  "AUTOMATION",
  "VERDICT",
  "REQUIRED_SESSION_PLAN",
] as const);
export type QaQueueFactKind = (typeof qaQueueFactKinds)[number];

export interface QaQueueFactChangedRef {
  readonly factKind: QaQueueFactKind;
  readonly factId: string;
  readonly revision: number;
  readonly semanticHash: Sha256Digest;
}

export function sortQaQueueFactRefs(
  refs: readonly QaQueueFactChangedRef[],
): readonly QaQueueFactChangedRef[] {
  return Object.freeze(
    canonicalSort(refs, (ref) => ({
      factId: ref.factId,
      factKind: ref.factKind,
      revision: ref.revision,
      semanticHash: ref.semanticHash,
    })).map((ref) => Object.freeze({ ...ref })),
  );
}

export interface QaQueueExactSourceRef {
  readonly sourceType: QaQueueSourceType;
  readonly sourceId: string;
  readonly sourceVersion: string | number;
  readonly semanticHash: Sha256Digest;
  readonly observedAt?: string;
  readonly confirmedAt?: string;
}

export interface QaQueueRequiredCapability {
  readonly capability: string;
  readonly minimumClaimVersion?: string;
}

export interface QaQueueActivity {
  readonly sessionId: string;
  readonly sessionRef: QaQueueExactSourceRef;
  readonly mode: "MANUAL" | "AUTOMATED";
  readonly state:
    "PLANNED" | "READY" | "RUNNING" | "REVIEW_REQUIRED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  readonly startedAt: string | null;
  readonly reviewRequiredAt: string | null;
  readonly blockedAt: string | null;
}

export interface QaQueueFacts extends QaScope {
  readonly workItemId: string;
  readonly qaInputRef: QaQueueExactSourceRef;
  readonly readinessRef: QaQueueExactSourceRef | null;
  readonly readiness: "NOT_ASSESSED" | "NEEDS_INFO" | "READY" | "READY_WITH_WAIVER" | "STALE";
  readonly requiredSessionPlanRef: QaQueueExactSourceRef | null;
  readonly requiredCapabilities: readonly QaQueueRequiredCapability[];
  readonly activities: readonly QaQueueActivity[];
  readonly automationRefs: readonly QaQueueExactSourceRef[];
  readonly firstConsumingStartAt: string | null;
  readonly signedVerdictRef: QaQueueExactSourceRef | null;
  readonly sourceRefs: readonly QaQueueExactSourceRef[];
  readonly sourceSetHash: Sha256Digest;
}

const refKey = (ref: QaQueueExactSourceRef): JsonValue => [
  ref.sourceType,
  ref.sourceId,
  ref.sourceVersion,
  ref.semanticHash,
];

export function sortQaQueueSourceRefs(
  refs: readonly QaQueueExactSourceRef[],
): readonly QaQueueExactSourceRef[] {
  const sorted = canonicalSort(refs, refKey);
  for (let index = 1; index < sorted.length; index += 1) {
    if (canonicalize(refKey(sorted[index - 1]!)) === canonicalize(refKey(sorted[index]!))) {
      throw new QaDomainError("QA_QUEUE_SOURCE_REF_DUPLICATE");
    }
  }
  return Object.freeze(sorted.map((ref) => Object.freeze({ ...ref })));
}

export function qaQueueSourceSetHash(refs: readonly QaQueueExactSourceRef[]): Sha256Digest {
  return sha256(sortQaQueueSourceRefs(refs).map(refKey));
}

export function qaQueueFactKindFor(ref: QaQueueExactSourceRef): QaQueueFactKind | undefined {
  switch (ref.sourceType) {
    case "QA_READINESS":
      return "READINESS";
    case "QA_REQUIRED_SESSION_PLAN":
      return "REQUIRED_SESSION_PLAN";
    case "QA_SESSION":
      return "SESSION";
    case "QA_AUTOMATION":
      return "AUTOMATION";
    case "QA_SIGNED_VERDICT":
      return "VERDICT";
    case "QA_INPUT":
      return undefined;
  }
}

export function createQaQueueFacts(
  input: Omit<QaQueueFacts, "sourceRefs" | "sourceSetHash"> &
    Readonly<{
      sourceRefs: readonly QaQueueExactSourceRef[];
    }>,
): QaQueueFacts {
  if (!input.workspaceId || !input.projectId || !input.workItemId)
    throw new QaDomainError("QA_QUEUE_SCOPE_INVALID");
  const sourceRefs = sortQaQueueSourceRefs(input.sourceRefs);
  const requiredCapabilities = Object.freeze(
    [...input.requiredCapabilities]
      .sort((left, right) =>
        `${left.capability}\u0000${left.minimumClaimVersion ?? ""}`.localeCompare(
          `${right.capability}\u0000${right.minimumClaimVersion ?? ""}`,
        ),
      )
      .map((value) => Object.freeze({ ...value })),
  );
  const activities = Object.freeze(
    [...input.activities]
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
      .map((value) => Object.freeze({ ...value })),
  );
  const automationRefs = sortQaQueueSourceRefs(input.automationRefs);
  return Object.freeze({
    ...input,
    requiredCapabilities,
    activities,
    automationRefs,
    sourceRefs,
    sourceSetHash: qaQueueSourceSetHash(sourceRefs),
  });
}

export interface QueuePlanningFactsContribution {
  readonly key: string;
  readonly version: "1.0.0";
  read(scope: QaScope, workItemId: string): Promise<QaQueueFacts | undefined>;
}

export interface QueuePlanningFactsInvalidationContribution {
  readonly eventType: "qa.queue-facts.changed";
  readonly version: "1.0.0";
}

export const qaQueuePlanningFactsInvalidationContribution = Object.freeze({
  eventType: "qa.queue-facts.changed",
  version: "1.0.0",
} as const satisfies QueuePlanningFactsInvalidationContribution);

export interface QaQueueFactsProjectionCommit {
  readonly facts: QaQueueFacts;
  readonly semanticHash: Sha256Digest;
  readonly event: Readonly<{
    eventType: "qa.queue-facts.changed";
    payload: Readonly<{
      schemaVersion: "qa-queue-facts-changed@1.0.0";
      invalidationId: string;
      workspaceId: string;
      projectId: string;
      workItemId: string;
      changedFactKinds: readonly QaQueueFactKind[];
      changedFactRefs: readonly QaQueueFactChangedRef[];
      occurredAt: string;
      semanticHash: Sha256Digest;
    }>;
    correlationId: string;
    causationId: string;
  }>;
}

export interface QaQueueFactsProjectionCommitPort {
  /** Revision, current pointer and outbox invalidation commit in one transaction. */
  commit(
    input: QaQueueFactsProjectionCommit,
  ): Promise<Readonly<{ changed: boolean; revisionNumber: number }>>;
}

export interface ProjectQaQueueFactsInput {
  readonly facts: QaQueueFacts;
  readonly semanticHash: Sha256Digest;
  readonly invalidationId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly changedFactRefs?: readonly QaQueueFactChangedRef[];
}

/** Application service whose single port operation is the transaction boundary. */
export class QaQueueFactsProjectionService {
  constructor(private readonly store: QaQueueFactsProjectionCommitPort) {}

  async project(
    input: ProjectQaQueueFactsInput,
  ): Promise<Readonly<{ changed: boolean; revisionNumber: number }>> {
    if (
      !/^sha256:[a-f0-9]{64}$/u.test(input.semanticHash) ||
      Number.isNaN(Date.parse(input.occurredAt))
    ) {
      throw new QaDomainError("QA_QUEUE_FACT_PROJECTION_INPUT_INVALID");
    }
    const derivedChangedRefs = input.facts.sourceRefs.flatMap(
      (ref): readonly QaQueueFactChangedRef[] => {
        const factKind = qaQueueFactKindFor(ref);
        return factKind === undefined ||
          !Number.isInteger(ref.sourceVersion) ||
          Number(ref.sourceVersion) < 1
          ? []
          : [
              Object.freeze({
                factKind,
                factId: ref.sourceId,
                revision: Number(ref.sourceVersion),
                semanticHash: ref.semanticHash,
              }),
            ];
      },
    );
    const changedFactRefs = sortQaQueueFactRefs(input.changedFactRefs ?? derivedChangedRefs);
    if (changedFactRefs.length === 0)
      throw new QaDomainError("QA_QUEUE_FACT_INVALIDATION_REFS_REQUIRED");
    const changedFactKinds = Object.freeze(
      [...new Set(changedFactRefs.map(({ factKind }) => factKind))].sort(),
    );
    return this.store.commit(
      Object.freeze({
        facts: input.facts,
        semanticHash: input.semanticHash,
        event: Object.freeze({
          eventType: "qa.queue-facts.changed",
          payload: Object.freeze({
            schemaVersion: "qa-queue-facts-changed@1.0.0",
            invalidationId: input.invalidationId,
            workspaceId: input.facts.workspaceId,
            projectId: input.facts.projectId,
            workItemId: input.facts.workItemId,
            changedFactKinds,
            changedFactRefs,
            occurredAt: input.occurredAt,
            semanticHash: input.semanticHash,
          }),
          correlationId: input.correlationId,
          causationId: input.causationId,
        }),
      }),
    );
  }
}
