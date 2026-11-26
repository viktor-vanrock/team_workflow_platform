import type { DataSource } from "typeorm";

import {
  type QaAutomationAttemptRecord,
  TypeOrmAutomationExecutionRepository,
} from "@awp/competency-qa/node";
import { sha256 } from "@awp/platform-contracts";
import { pilotContentHash } from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import type { PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import { PublishedDeploymentReferences } from "../pilot/published-deployment-references.ts";
import { corporateGitLabRetryPolicy, resolveCorporateGitLabC1 } from "./corporate-c1-metadata.ts";

/** Recheck the original durable command and its pinned deployment before resolving retry policy. */
export function createCorporateGitLabRetryPolicyAuthority(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    guard: PilotCommandEffectGuard;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment?.workspaceId ||
    !deployment.projectIds.length ||
    typeof input.guard?.assertCommandAllowed !== "function"
  )
    throw new Error("CORPORATE_GITLAB_RETRY_AUTHORITY_REQUIRED");
  const attempts = new TypeOrmAutomationExecutionRepository(input.source);
  const commands = new TypeOrmCommandRepository(input.source);
  return {
    async resolve(attempt: QaAutomationAttemptRecord, signal: AbortSignal) {
      if (
        signal.aborted ||
        attempt.workspaceId !== deployment.workspaceId ||
        !deployment.projectIds.includes(attempt.projectId)
      )
        throw new Error("CORPORATE_GITLAB_RETRY_SCOPE_DENIED");
      const scope = { workspaceId: attempt.workspaceId, projectId: attempt.projectId };
      const current = await attempts.automationAttempt(scope, attempt.automationAttemptId);
      if (
        !current ||
        !["RUNNING", "TERMINAL"].includes(current.currentStatus) ||
        pilotContentHash(current) !== pilotContentHash(attempt)
      )
        throw new Error("CORPORATE_GITLAB_RETRY_ATTEMPT_STALE");
      const command = await commands.get(
        scope.workspaceId,
        scope.projectId,
        current.connectorCommandId,
      );
      if (!command || sha256(command.effectIdempotencyKey) !== current.effectKeyHash)
        throw new Error("CORPORATE_GITLAB_RETRY_COMMAND_INVALID");
      await input.guard.assertCommandAllowed(command);
      const approved = await new PublishedDeploymentReferences(input.source, deployment, 5000).load(
        deployment,
        signal,
      );
      const metadata = resolveCorporateGitLabC1(
        input.environment,
        approved.publications,
        scope.projectId,
      );
      const policy = corporateGitLabRetryPolicy(metadata, current);
      const artifact = metadata.artifactContract;
      if (
        artifact.artifactPolicyRef !== current.artifactPolicyRef ||
        artifact.artifactPolicyHash !== current.artifactPolicyHash ||
        typeof artifact.minimumRetentionSeconds !== "number" ||
        !Number.isSafeInteger(artifact.minimumRetentionSeconds) ||
        typeof artifact.maximumRetentionSeconds !== "number" ||
        !Number.isSafeInteger(artifact.maximumRetentionSeconds) ||
        artifact.minimumRetentionSeconds < 0 ||
        artifact.maximumRetentionSeconds < artifact.minimumRetentionSeconds ||
        typeof artifact.maxBytes !== "number" ||
        !Number.isSafeInteger(artifact.maxBytes) ||
        artifact.maxBytes < 1 ||
        !Array.isArray(artifact.allowedTypes) ||
        artifact.allowedTypes.some((value) => typeof value !== "string") ||
        !Array.isArray(artifact.allowedClassifications) ||
        artifact.allowedClassifications.some((key) => typeof key !== "string")
      )
        throw new Error("CORPORATE_GITLAB_ARTIFACT_POLICY_MISMATCH");
      await input.guard.assertCommandAllowed(command);
      const latest = await attempts.automationAttempt(scope, attempt.automationAttemptId);
      if (signal.aborted || !latest || pilotContentHash(latest) !== pilotContentHash(current))
        throw new Error("CORPORATE_GITLAB_RETRY_ATTEMPT_STALE");
      return Object.freeze({
        policy,
        metadataHash: metadata.contentHash,
        numericProjectId: metadata.numericGitLabProjectId,
        server: Object.freeze({
          edition: metadata.server.edition,
          exactVersion: metadata.server.exactVersion,
          exactBuild: metadata.server.exactBuild,
        }),
        artifactPolicy: Object.freeze({
          minimumRetentionSeconds: artifact.minimumRetentionSeconds,
          maximumRetentionSeconds: artifact.maximumRetentionSeconds,
          allowedClassifications: Object.freeze([...(artifact.allowedClassifications as string[])]),
          allowedTypes: Object.freeze([...(artifact.allowedTypes as string[])]),
          maxBytes: artifact.maxBytes,
        }),
      });
    },
  };
}
