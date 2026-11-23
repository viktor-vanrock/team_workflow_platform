import {
  QaCompletionCandidateAggregate,
  type QaCompletionCandidateInput,
} from "../domain/completion.ts";
import { QaDomainError } from "../domain/primitives.ts";

export function createCompletionCandidate(
  input: QaCompletionCandidateInput,
): QaCompletionCandidateAggregate {
  if (input.initiatedBy.kind !== "HUMAN")
    throw new QaDomainError("QA_COMPLETION_HUMAN_EXECUTOR_REQUIRED");
  return new QaCompletionCandidateAggregate(input);
}
