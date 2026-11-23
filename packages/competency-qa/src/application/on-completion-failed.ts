import type { QaCompletionCandidateStore } from "./invalidate-completion-candidate.ts";

export function failQaCompletion(
  store: QaCompletionCandidateStore,
  input: Readonly<{ candidateId: string; code: string; reason: string; at: string }>,
): void {
  const candidate = store.candidate(input.candidateId);
  if (!candidate) throw new Error("QA_COMPLETION_CANDIDATE_NOT_FOUND");
  candidate.fail({ code: input.code, reason: input.reason, at: input.at });
  store.releaseInFlight(candidate);
}
