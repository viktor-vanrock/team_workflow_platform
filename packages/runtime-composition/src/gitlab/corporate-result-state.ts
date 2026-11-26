import type { DataSource } from "typeorm";
import {
  TypeOrmAutomationExecutionRepository,
  type QaAutomatedTargetSnapshot,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptResult,
} from "@awp/competency-qa/node";
import { sha256, type JsonValue } from "@awp/platform-contracts";
import type { RuntimeEnvironment } from "../config/environment.ts";

const parse = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

/** Reload the scoped durable facts used by terminal result application or retry recovery. */
export function createCorporateGitLabResultState(
  source: DataSource,
  environment: RuntimeEnvironment,
) {
  const deployment = environment.deployment;
  if (
    !source.isInitialized ||
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deployment?.workspaceId ||
    !deployment.projectIds.length
  )
    throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_REQUIRED");
  const repository = new TypeOrmAutomationExecutionRepository(source);
  return {
    async load(
      scope: Readonly<{ workspaceId: string; projectId: string; attemptId: string }>,
      status: "RUNNING" | "TERMINAL",
    ) {
      if (
        scope.workspaceId !== deployment.workspaceId ||
        !deployment.projectIds.includes(scope.projectId)
      )
        throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
      const attempt = await repository.automationAttempt(scope, scope.attemptId);
      if (!attempt || attempt.currentStatus !== status)
        throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
      const [attempts, history, sessions] = await Promise.all([
        repository.automationAttempts(scope, attempt.testSessionId),
        repository.automationStatusHistory(scope, attempt.automationAttemptId),
        source.query(
          "SELECT state,resource_version,target_snapshot FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
          [scope.workspaceId, scope.projectId, attempt.testSessionId],
        ) as Promise<
          readonly { state: string; resource_version: number; target_snapshot: unknown }[]
        >,
      ]);
      const row = sessions[0];
      if (
        sessions.length !== 1 ||
        !row ||
        !["RUNNING", "REVIEW_REQUIRED"].includes(row.state) ||
        !Number.isSafeInteger(Number(row.resource_version)) ||
        Number(row.resource_version) < 1
      )
        throw new Error("CORPORATE_GITLAB_RESULT_SESSION_STALE");
      const snapshot = parse<QaAutomatedTargetSnapshot>(row.target_snapshot);
      const { snapshotHash, ...body } = snapshot;
      if (
        snapshotHash !== attempt.targetSnapshotHash ||
        snapshot.workspaceId !== scope.workspaceId ||
        snapshot.projectId !== scope.projectId ||
        snapshot.testSessionId !== attempt.testSessionId ||
        sha256(body as unknown as JsonValue) !== snapshotHash
      )
        throw new Error("CORPORATE_GITLAB_RESULT_SNAPSHOT_STALE");
      const lineage = attempts
        .filter(
          (item) =>
            item.planItemId === attempt.planItemId &&
            item.rootAttemptId === attempt.rootAttemptId &&
            item.attemptNo <= attempt.attemptNo,
        )
        .sort((a, b) => a.attemptNo - b.attemptNo);
      if (
        lineage.length !== attempt.attemptNo ||
        lineage.some(
          (item, index) =>
            item.attemptNo !== index + 1 ||
            (index > 0 && item.predecessorAttemptId !== lineage[index - 1]!.automationAttemptId),
        ) ||
        lineage.at(-1)?.automationAttemptId !== attempt.automationAttemptId
      )
        throw new Error("CORPORATE_GITLAB_RESULT_LINEAGE_INVALID");
      const previousStatus = history.find(
        (item) => item.statusRevisionId === attempt.currentStatusRevisionId,
      );
      if (
        !previousStatus ||
        previousStatus.status !== status ||
        previousStatus.revisionNo !== attempt.currentStatusRevisionNo
      )
        throw new Error("CORPORATE_GITLAB_RESULT_STATUS_STALE");
      const previousLineageResults: {
        attemptNo: number;
        outcome: QaAutomationAttemptResult["outcome"];
      }[] = [];
      for (const previous of lineage.slice(0, -1)) {
        const saved = await repository.terminalResult(scope, previous.automationAttemptId);
        if (!saved) throw new Error("CORPORATE_GITLAB_RESULT_LINEAGE_INVALID");
        const result = parse<QaAutomationAttemptResult>(saved.content);
        const { contentHash, ...resultBody } = result;
        if (
          previous.currentStatus !== "TERMINAL" ||
          previous.terminalResultId !== result.automationAttemptResultId ||
          result.automationAttemptId !== previous.automationAttemptId ||
          result.workspaceId !== scope.workspaceId ||
          result.projectId !== scope.projectId ||
          sha256(resultBody as unknown as JsonValue) !== contentHash
        )
          throw new Error("CORPORATE_GITLAB_RESULT_LINEAGE_INVALID");
        previousLineageResults.push({ attemptNo: previous.attemptNo, outcome: result.outcome });
      }
      const current = await repository.automationAttempt(scope, scope.attemptId);
      if (
        !current ||
        sha256(current as unknown as JsonValue) !== sha256(attempt as unknown as JsonValue)
      )
        throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
      let terminalResult: QaAutomationAttemptResult | undefined;
      if (status === "TERMINAL") {
        const saved = await repository.terminalResult(scope, attempt.automationAttemptId);
        if (!saved) throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
        const result = parse<QaAutomationAttemptResult>(saved.content);
        const { contentHash, ...resultBody } = result;
        if (
          result.workspaceId !== scope.workspaceId ||
          result.projectId !== scope.projectId ||
          result.automationAttemptId !== attempt.automationAttemptId ||
          result.automationAttemptResultId !== attempt.terminalResultId ||
          sha256(resultBody as unknown as JsonValue) !== contentHash
        )
          throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
        terminalResult = result;
      }
      return Object.freeze({
        attempt: attempt as QaAutomationAttemptRecord,
        previousStatus,
        targetSnapshot: snapshot,
        lineage: Object.freeze(lineage),
        previousLineageResults: Object.freeze(previousLineageResults),
        ...(terminalResult ? { terminalResult } : {}),
        session: Object.freeze({
          state: row.state as "RUNNING" | "REVIEW_REQUIRED",
          resourceVersion: Number(row.resource_version),
        }),
      });
    },
  };
}
