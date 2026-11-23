import { assessQaIntakeCompleteness, type QaIntakeRevisionSubject } from "@awp/competency-qa";
import type { JsonValue } from "@awp/platform-contracts";

export interface DraftActionIntentPort {
  consume(
    input: Readonly<{
      intentId: string;
      intentToken: string;
      principalId: string;
      subjectVersion: number;
      subjectContentHash: string;
      resultRef: string;
    }>,
  ): Promise<Readonly<{ replayed: boolean; resultRef: string }>>;
  invalidateSiblings(intentId: string): Promise<void>;
  purgeCapsule(intentId: string): Promise<void>;
}
export interface DraftActionMutationPort {
  revise(
    input: Readonly<{
      subject: QaIntakeRevisionSubject;
      principalId: string;
      content: Readonly<Record<string, JsonValue>>;
    }>,
  ): Promise<QaIntakeRevisionSubject>;
  confirm(
    input: Readonly<{ subject: QaIntakeRevisionSubject; principalId: string; requestKey: string }>,
  ): Promise<unknown>;
}

export class MattermostDraftActions {
  constructor(
    private readonly intents: DraftActionIntentPort,
    private readonly mutations: DraftActionMutationPort,
  ) {}
  async revise(
    input: Readonly<{
      intentId: string;
      intentToken: string;
      principalId: string;
      subject: QaIntakeRevisionSubject;
      content: Readonly<Record<string, JsonValue>>;
    }>,
  ) {
    const ref = `draft:${input.subject.draftId}:revision:${input.subject.revision + 1}`;
    const claim = await this.intents.consume({
      ...input,
      subjectVersion: input.subject.revision,
      subjectContentHash: input.subject.contentHash,
      resultRef: ref,
    });
    if (claim.replayed) return claim;
    const result = await this.mutations.revise(input);
    await this.intents.invalidateSiblings(input.intentId);
    await this.intents.purgeCapsule(input.intentId);
    return Object.freeze({
      replayed: false,
      resultRef: `draft:${result.draftId}:revision:${result.revision}`,
      draft: result,
    });
  }
  validate(subject: QaIntakeRevisionSubject) {
    return assessQaIntakeCompleteness(subject);
  }
  async confirm(
    input: Readonly<{
      intentId: string;
      intentToken: string;
      principalId: string;
      subject: QaIntakeRevisionSubject;
      requestKey: string;
    }>,
  ) {
    const resultRef = `draft:${input.subject.draftId}:confirmation:${input.requestKey}`;
    const claim = await this.intents.consume({
      ...input,
      subjectVersion: input.subject.revision,
      subjectContentHash: input.subject.contentHash,
      resultRef,
    });
    if (claim.replayed) return claim;
    const result = await this.mutations.confirm(input);
    await this.intents.invalidateSiblings(input.intentId);
    await this.intents.purgeCapsule(input.intentId);
    return Object.freeze({ replayed: false, resultRef, result });
  }
}
