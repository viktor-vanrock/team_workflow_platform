import type { JsonValue } from "@awp/platform-contracts";

import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import { qaCanonicalContentHash } from "../domain/revisions.ts";

export interface QaPlatformAction<TCandidate = unknown, TResult = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly candidate: TCandidate;
  readonly candidateHash: string;
  readonly initiatorId: string;
  readonly state: "PENDING_APPROVAL" | "EXECUTING" | "COMPLETED" | "FAILED";
  readonly result?: TResult;
  readonly rowVersion: number;
}

export interface QaPlatformActionPort<TCandidate = unknown, TResult = unknown> {
  save(action: QaPlatformAction<TCandidate, TResult>): Promise<void>;
  get(id: string): Promise<QaPlatformAction<TCandidate, TResult> | undefined>;
}

export interface QaExactActionCandidate<TSubject extends JsonValue> {
  readonly actionKind: string;
  readonly scope: QaScope;
  readonly subject: TSubject;
  readonly subjectHash: `sha256:${string}`;
  readonly expiresAt?: string;
}

export class QaExactActionClient<TSubject extends JsonValue, TResult = unknown> {
  constructor(
    private readonly actions: QaPlatformActionPort<QaExactActionCandidate<TSubject>, TResult>,
  ) {}

  async create(
    input: Readonly<{
      id: string;
      actionKind: string;
      scope: QaScope;
      subject: TSubject;
      initiatorId: string;
      expiresAt?: string;
    }>,
  ): Promise<QaPlatformAction<QaExactActionCandidate<TSubject>, TResult>> {
    if (input.id.length === 0 || input.actionKind.length === 0 || input.initiatorId.length === 0) {
      throw new QaDomainError("QA_EXACT_ACTION_INVALID");
    }
    if (input.expiresAt !== undefined && Number.isNaN(Date.parse(input.expiresAt))) {
      throw new QaDomainError("QA_EXACT_ACTION_EXPIRY_INVALID");
    }
    const subjectHash = qaCanonicalContentHash(input.subject);
    const candidate = Object.freeze({
      actionKind: input.actionKind,
      scope: Object.freeze({ ...input.scope }),
      subject: structuredClone(input.subject),
      subjectHash,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
    const action = Object.freeze({
      id: input.id,
      kind: input.actionKind,
      candidate,
      candidateHash: qaCanonicalContentHash(candidate as unknown as JsonValue),
      initiatorId: input.initiatorId,
      state: "PENDING_APPROVAL" as const,
      rowVersion: 1,
    });
    await this.actions.save(action);
    return action;
  }

  async getExact(
    actionId: string,
    expectedCandidateHash: string,
  ): Promise<QaPlatformAction<QaExactActionCandidate<TSubject>, TResult>> {
    const action = await this.actions.get(actionId);
    if (action === undefined) throw new QaDomainError("QA_EXACT_ACTION_NOT_FOUND");
    if (action.candidateHash !== expectedCandidateHash) {
      throw new QaDomainError("QA_EXACT_ACTION_CANDIDATE_MISMATCH");
    }
    return action;
  }
}

export interface QaPlatformActionExecutionContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly approvalId: string;
  readonly approverId: string;
  readonly authorizationBasisHash: string;
}

export interface QaExactActionHandlerContribution<TCandidate, TResult> {
  readonly key: string;
  readonly order?: number;
  matches(action: QaPlatformAction): boolean;
  execute(
    action: QaPlatformAction<TCandidate, TResult>,
    context: QaPlatformActionExecutionContext,
  ): Promise<TResult>;
}

export function defineQaExactActionHandlerContribution<TCandidate, TResult>(
  input: Readonly<{
    key: string;
    actionKind: string;
    order?: number;
    execute(
      action: QaPlatformAction<TCandidate, TResult>,
      context: QaPlatformActionExecutionContext,
    ): Promise<TResult>;
  }>,
): QaExactActionHandlerContribution<TCandidate, TResult> {
  if (input.key.length === 0 || input.actionKind.length === 0) {
    throw new QaDomainError("QA_EXACT_ACTION_HANDLER_INVALID");
  }
  return Object.freeze({
    key: input.key,
    ...(input.order === undefined ? {} : { order: input.order }),
    matches: (action: QaPlatformAction) => action.kind === input.actionKind,
    execute: input.execute,
  });
}
