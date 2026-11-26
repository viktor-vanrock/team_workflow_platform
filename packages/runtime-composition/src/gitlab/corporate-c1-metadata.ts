import type { QaAutomationAttemptRecord, QaAutomationRetryPolicy } from "@awp/competency-qa/node";
import {
  type GitLabPilotMetadataPackage,
  type JsonValue,
  sha256,
  validateGitLabPilotMetadataPackage,
} from "@awp/platform-contracts";
import { type ExactRevisionRef, pilotContentHash, samePilotRef } from "@awp/platform-core";
import type { RuntimeConfigurationPublication } from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";

/** Read C1 only from the exact currently approved GitLab deployment publication. */
export function resolveCorporateGitLabC1(
  environment: RuntimeEnvironment,
  publications: readonly RuntimeConfigurationPublication[],
  projectId: string,
): GitLabPilotMetadataPackage {
  const deployment = environment.deployment;
  if (
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    !deployment.projectIds.includes(projectId)
  )
    throw new Error("CORPORATE_GITLAB_C1_SCOPE_DENIED");
  const pins = deployment.connectorBindings.filter((pin) => pin.provider === "gitlab");
  const matches = publications.filter(
    (publication) =>
      publication.kind === "CONNECTOR_BINDING" &&
      pins.some((pin) => samePilotRef(pin.ref, publication.ref)),
  );
  if (
    pins.length !== 1 ||
    matches.length !== 1 ||
    matches[0]!.workspaceId !== deployment.workspaceId ||
    pilotContentHash(matches[0]!.document) !== matches[0]!.ref.contentHash ||
    !Number.isFinite(Date.parse(matches[0]!.validUntil)) ||
    Date.parse(matches[0]!.validUntil) <= Date.now() ||
    matches[0]!.projectIds.length !== deployment.projectIds.length ||
    matches[0]!.projectIds.some((id) => !deployment.projectIds.includes(id)) ||
    !matches[0]!.projectIds.includes(projectId) ||
    matches[0]!.document.provider !== "gitlab" ||
    !Array.isArray(matches[0]!.document.projects)
  )
    throw new Error("CORPORATE_GITLAB_C1_PUBLICATION_REQUIRED");
  const projects = (matches[0]!.document.projects as readonly unknown[]).filter(
    (value): value is Record<string, unknown> =>
      Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).projectId === projectId,
      ),
  );
  if (projects.length !== 1 || !projects[0]!.gitlabPilotMetadata)
    throw new Error("CORPORATE_GITLAB_C1_METADATA_REQUIRED");
  let metadata: GitLabPilotMetadataPackage;
  try {
    metadata = validateGitLabPilotMetadataPackage(projects[0]!.gitlabPilotMetadata);
  } catch {
    throw new Error("CORPORATE_GITLAB_C1_METADATA_INVALID");
  }
  const endpoint = deployment.endpoints.find((item) => item.purpose === "gitlab");
  const selected = metadata.configurationPins.filter((pin) => pin.logicalRole === "TEST_EXECUTION");
  const exact = (ref: { id: string; version: number }, hash: string, expected: unknown) =>
    Boolean(
      expected &&
      typeof expected === "object" &&
      samePilotRef({ ...ref, contentHash: hash } as ExactRevisionRef, expected as ExactRevisionRef),
    );
  if (
    metadata.workspaceId !== deployment.workspaceId ||
    metadata.projectId !== projectId ||
    metadata.contourKey !== environment.composition ||
    metadata.environmentClass !==
      (environment.composition.endsWith("-development") ? "DEVELOPMENT" : "TEST") ||
    !endpoint ||
    metadata.server.baseUrl !== endpoint.url ||
    selected.length !== 1 ||
    !exact(
      selected[0]!.projectIntegrationBindingRef,
      selected[0]!.projectIntegrationBindingHash,
      projects[0]!.integrationBindingRef,
    ) ||
    !exact(selected[0]!.profileRef, selected[0]!.profileHash, projects[0]!.profileRef) ||
    !exact(selected[0]!.connectionRef, selected[0]!.connectionHash, projects[0]!.connectionRef)
  )
    throw new Error("CORPORATE_GITLAB_C1_PIN_MISMATCH");
  return metadata;
}

/** Do not infer an allowlist from a policy reference or from provider output. */
export function corporateGitLabRetryPolicy(
  metadata: GitLabPilotMetadataPackage,
  attempt: QaAutomationAttemptRecord,
): QaAutomationRetryPolicy {
  let verified: GitLabPilotMetadataPackage;
  try {
    verified = validateGitLabPilotMetadataPackage(metadata);
  } catch {
    throw new Error("CORPORATE_GITLAB_RETRY_POLICY_MISMATCH");
  }
  const policy = verified.qaRetryPolicy;
  const { policyHash: _declaredHash, ...policyDocument } = policy;
  void _declaredHash;
  const pinMatches =
    attempt.configurationPins.length === 3 &&
    verified.configurationPins.length === 3 &&
    attempt.configurationPins.every((pin) => {
      const selected = verified.configurationPins.filter(
        (value) => value.logicalRole === pin.logicalRole,
      );
      const value = selected[0];
      return (
        selected.length === 1 &&
        value !== undefined &&
        value.capabilityKey === pin.capabilityKey &&
        value.exactContractVersion === pin.exactContractVersion &&
        value.operationSetHash === pin.operationSetHash &&
        value.projectIntegrationBindingRef.id === pin.projectIntegrationBindingRef.id &&
        value.projectIntegrationBindingRef.version === pin.projectIntegrationBindingRef.version &&
        value.projectIntegrationBindingHash === pin.projectIntegrationBindingRef.contentHash &&
        value.profileRef.id === pin.profileRef.id &&
        value.profileRef.version === pin.profileRef.version &&
        value.profileHash === pin.profileRef.contentHash &&
        value.connectionRef.id === pin.connectionRef.id &&
        value.connectionRef.version === pin.connectionRef.version &&
        value.connectionHash === pin.connectionRef.contentHash &&
        value.validationReportId === pin.validationReportRef.id &&
        value.validationEvidenceHash === pin.validationReportRef.contentHash
      );
    });
  if (
    verified.workspaceId !== attempt.workspaceId ||
    verified.projectId !== attempt.projectId ||
    !pinMatches ||
    policy.policyRef !== attempt.retryPolicyRef ||
    policy.policyHash !== attempt.retryPolicyHash ||
    sha256(policyDocument as JsonValue) !== attempt.retryPolicyHash ||
    !Array.isArray(policy.allowedInfrastructureCodes) ||
    policy.maxAutomaticRetries !== 1 ||
    !Array.isArray(policy.allowedInfrastructureCodes) ||
    policy.allowedInfrastructureCodes.some(
      (value) => typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value),
    ) ||
    new Set(policy.allowedInfrastructureCodes).size !== policy.allowedInfrastructureCodes.length
  )
    throw new Error("CORPORATE_GITLAB_RETRY_POLICY_MISMATCH");
  return Object.freeze({
    policyRef: attempt.retryPolicyRef,
    policyHash: attempt.retryPolicyHash,
    automaticRetryBudget: 1,
    allowedInfrastructureCodes: Object.freeze([...(policy.allowedInfrastructureCodes as string[])]),
  });
}
