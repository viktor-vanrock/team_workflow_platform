import type { RuntimeEnvironment } from "../config/environment.ts";
import type {
  GitLabAutomationResultSyncRequest,
  GitLabAutomationResultSyncConsumer,
} from "./result-sync.ts";
import type { createCorporateGitLabTerminalCandidateScanner } from "./corporate-terminal-candidates.ts";

type Scanner = ReturnType<typeof createCorporateGitLabTerminalCandidateScanner>;
type Candidate = Awaited<ReturnType<Scanner["scan"]>>[number];
type Recovery = Awaited<ReturnType<Scanner["scanRetryRecovery"]>>[number];
type RecoveryInput = Parameters<GitLabAutomationResultSyncConsumer["resumeRetry"]>[0];

/** The authority obtains provider facts and policy server-side, and revalidates them immediately before commit. */
export interface CorporateGitLabResultAuthority {
  prepare(candidate: Candidate, signal: AbortSignal): Promise<GitLabAutomationResultSyncRequest>;
  prepareRecovery(candidate: Recovery, signal: AbortSignal): Promise<RecoveryInput>;
  revalidate(
    candidate: Candidate | Recovery,
    signal: AbortSignal,
    request: GitLabAutomationResultSyncRequest | RecoveryInput,
  ): Promise<void>;
}

export function createCorporateGitLabResultWorker(
  input: Readonly<{
    environment: RuntimeEnvironment;
    scanner: Scanner;
    authority: CorporateGitLabResultAuthority;
    consumer: Pick<GitLabAutomationResultSyncConsumer, "consume" | "resumeRetry">;
    deadlineMs?: number;
  }>,
) {
  const deployment = input.environment.deployment;
  const deadlineMs = input.deadlineMs ?? 30_000;
  if (
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment?.workspaceId ||
    !deployment.projectIds.length ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1000 ||
    deadlineMs > 60_000 ||
    typeof input.scanner?.scan !== "function" ||
    typeof input.scanner.scanRetryRecovery !== "function" ||
    typeof input.authority?.prepare !== "function" ||
    typeof input.authority.prepareRecovery !== "function" ||
    typeof input.authority.revalidate !== "function" ||
    typeof input.consumer?.consume !== "function" ||
    typeof input.consumer.resumeRetry !== "function"
  )
    throw new Error("CORPORATE_GITLAB_RESULT_WORKER_REQUIRED");
  const scoped = (candidate: Candidate | Recovery) =>
    candidate.workspaceId === deployment.workspaceId &&
    deployment.projectIds.includes(candidate.projectId);
  return {
    async run() {
      // The enclosing worker loop runs contributions serially. Bound work per
      // tick so a backlog of slow provider reads cannot hold every other queue.
      const candidates = await input.scanner.scan(1);
      let applied = 0,
        deferred = 0;
      for (const candidate of candidates) {
        try {
          if (!scoped(candidate)) throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
          const signal = AbortSignal.timeout(deadlineMs);
          const request = await input.authority.prepare(candidate, signal);
          if (
            signal.aborted ||
            request.facts.attempt.workspaceId !== candidate.workspaceId ||
            request.facts.attempt.projectId !== candidate.projectId ||
            request.facts.attempt.automationAttemptId !== candidate.attemptId ||
            request.facts.attempt.connectorCommandId !== candidate.commandId ||
            request.facts.observation.observationHash !== candidate.observationHash
          )
            throw new Error("CORPORATE_GITLAB_RESULT_CANDIDATE_MISMATCH");
          await input.authority.revalidate(candidate, signal, request);
          if (signal.aborted) throw new Error("CORPORATE_GITLAB_RESULT_DEADLINE");
          await input.consumer.consume(request);
          applied++;
        } catch {
          deferred++;
        }
      }
      const recoveries = await input.scanner.scanRetryRecovery(1);
      let recovered = 0;
      for (const candidate of recoveries) {
        try {
          if (!scoped(candidate)) throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
          const signal = AbortSignal.timeout(deadlineMs);
          const request = await input.authority.prepareRecovery(candidate, signal);
          if (
            signal.aborted ||
            request.attempt.workspaceId !== candidate.workspaceId ||
            request.attempt.projectId !== candidate.projectId ||
            request.attempt.automationAttemptId !== candidate.attemptId ||
            request.result.automationAttemptResultId !== candidate.resultId
          )
            throw new Error("CORPORATE_GITLAB_RESULT_CANDIDATE_MISMATCH");
          await input.authority.revalidate(candidate, signal, request);
          if (signal.aborted) throw new Error("CORPORATE_GITLAB_RESULT_DEADLINE");
          await input.consumer.resumeRetry(request);
          recovered++;
        } catch {
          deferred++;
        }
      }
      return Object.freeze({ applied, recovered, deferred });
    },
  };
}
