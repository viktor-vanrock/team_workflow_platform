import {
  createGitLabDialect,
  type GitLabConnectionConfiguration,
  type GitLabDiscoveryRequest,
  GitLabDiscoveryService,
  type GitLabDiscoverySnapshot,
  type GitLabDiscoveryTransport,
  type GitLabProfileConfiguration,
  type GitLabProfileValidationResult,
  type GitLabSuiteProbe,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
  validateGitLabProfile,
} from "@awp/connector-gitlab";
import type { Sha256Digest } from "@awp/platform-contracts";
import type { CapabilityProbeResult, ExactRevisionRef, ProjectScope } from "@awp/platform-core";

import { createSafeCapabilityProbe } from "../onboarding/capability-probes.ts";

export interface GitLabCapabilityProbeSetInput extends ProjectScope {
  readonly probeIdPrefix: string;
  readonly bindingRef: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
  readonly mappingRef?: ExactRevisionRef;
  readonly validationReportRef: ExactRevisionRef;
  readonly expectedPipelineContractHash: Sha256Digest;
  readonly observedPipelineContractHash: Sha256Digest;
  readonly availableOperations: readonly string[];
  readonly observedScope?: ProjectScope;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly now: string;
}

const gitLabProbeRequirements = Object.freeze([
  Object.freeze({
    requirementKey: "gitlab-source-context",
    logicalRole: "SOURCE_CONTEXT",
    capabilityKey: "source-context.read",
    operations: Object.freeze(["merge-request.read", "commit.read", "build.read"]),
  }),
  Object.freeze({
    requirementKey: "gitlab-test-execution",
    logicalRole: "TEST_EXECUTION",
    capabilityKey: "test-executor.trigger-status",
    operations: Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"]),
  }),
  Object.freeze({
    requirementKey: "gitlab-artifact-source",
    logicalRole: "ARTIFACT_SOURCE",
    capabilityKey: "artifact.ci-read",
    operations: Object.freeze(["artifact.metadata", "artifact.stream"]),
  }),
] as const);

export function createGitLabCapabilityProbes(
  input: GitLabCapabilityProbeSetInput,
): readonly CapabilityProbeResult[] {
  const observedScope = input.observedScope ?? input;
  if (
    observedScope.workspaceId !== input.workspaceId ||
    observedScope.projectId !== input.projectId
  )
    throw new Error("GITLAB_PROBE_SCOPE_MISMATCH");
  if (input.expectedPipelineContractHash !== input.observedPipelineContractHash)
    throw new Error("GITLAB_PIPELINE_CONTRACT_MISMATCH");
  if (Number.isNaN(Date.parse(input.now)) || Date.parse(input.validUntil) <= Date.parse(input.now))
    throw new Error("GITLAB_PROBE_STALE");
  return Object.freeze(
    gitLabProbeRequirements.map((requirement, index) => {
      const missing = requirement.operations.filter(
        (operation) => !input.availableOperations.includes(operation),
      );
      const result = createSafeCapabilityProbe({
        probeId: `${input.probeIdPrefix}:${index + 1}`,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        bindingRef: input.bindingRef,
        profileRef: input.profileRef,
        connectionRef: input.connectionRef,
        ...(input.mappingRef ? { mappingRef: input.mappingRef } : {}),
        validationReportRef: input.validationReportRef,
        logicalRole: requirement.logicalRole,
        capabilityKey: requirement.capabilityKey,
        exactContractVersion: "1.0.0",
        operation: requirement.operations.join("+"),
        environmentScope: "NON_PROD",
        status: missing.length === 0 ? "AVAILABLE" : "UNAVAILABLE",
        safeIssueCodes: missing.map((operation) => `GITLAB_OPERATION_UNAVAILABLE:${operation}`),
        observedAt: input.observedAt,
        validUntil: input.validUntil,
      });
      return Object.freeze({ ...result, requirementKey: requirement.requirementKey });
    }),
  );
}

export interface ComposedGitLabProfileValidationRequest {
  readonly profile: unknown;
  readonly connection: unknown;
  readonly instance: Readonly<{
    edition: "CE" | "EE";
    exactVersion: string;
    exactBuild: string;
  }>;
  readonly suiteProbes: readonly GitLabSuiteProbe[];
  readonly sourceProbes?: GitLabDiscoveryRequest["sourceProbes"];
}

export type ComposedGitLabProfileValidationOutcome =
  | Readonly<{
      status: "DENIED";
      stage: "PREFLIGHT";
      issues: ReturnType<typeof preflightGitLabProfile>["issues"];
    }>
  | Readonly<{
      status: GitLabProfileValidationResult["status"];
      stage: "DISCOVERY";
      discovery: GitLabDiscoverySnapshot;
      validation: GitLabProfileValidationResult;
    }>;

export interface GitLabDiscoveryTransportFactory {
  create(
    connection: GitLabConnectionConfiguration,
    profile: GitLabProfileConfiguration,
  ): GitLabDiscoveryTransport;
}

/**
 * Runtime assembly for the Profile lifecycle. Static policy is evaluated
 * before the transport factory can resolve a secret or make provider I/O.
 */
export class ComposedGitLabProfileValidator {
  constructor(private readonly transports: GitLabDiscoveryTransportFactory) {}

  preflight(profile: unknown, connection: unknown) {
    let validatedConnection: GitLabConnectionConfiguration;
    try {
      validatedConnection = validateGitLabConnectionConfiguration(connection);
    } catch {
      return Object.freeze({
        status: "DENIED" as const,
        issues: Object.freeze([
          { code: "GITLAB_CONNECTION_CONFIGURATION_INVALID", subject: "CONNECTION" as const },
        ]),
      });
    }
    return preflightGitLabProfile(profile, validatedConnection);
  }

  async validate(
    request: ComposedGitLabProfileValidationRequest,
  ): Promise<ComposedGitLabProfileValidationOutcome> {
    let connection: GitLabConnectionConfiguration;
    try {
      connection = validateGitLabConnectionConfiguration(request.connection);
    } catch {
      return Object.freeze({
        status: "DENIED",
        stage: "PREFLIGHT",
        issues: Object.freeze([
          { code: "GITLAB_CONNECTION_CONFIGURATION_INVALID", subject: "CONNECTION" as const },
        ]),
      });
    }
    const preflight = preflightGitLabProfile(request.profile, connection);
    if (preflight.status === "DENIED" || !preflight.profile) {
      return Object.freeze({ status: "DENIED", stage: "PREFLIGHT", issues: preflight.issues });
    }
    const dialect = createGitLabDialect({
      adapterFamily: "gitlab-rest-v4",
      apiFamily: "v4",
      edition: request.instance.edition,
      exactVersion: request.instance.exactVersion,
      exactBuild: request.instance.exactBuild,
      triggerDialect: preflight.profile.trigger.dialect,
      webhookDialect: preflight.profile.webhook.verificationMode,
    });
    const discovery = await new GitLabDiscoveryService(
      this.transports.create(connection, preflight.profile),
      dialect,
    ).discover({
      numericProjectId: preflight.profile.numericGitLabProjectId,
      exactRef: preflight.profile.trigger.ref,
      expectedEdition: request.instance.edition,
      expectedVersion: request.instance.exactVersion,
      expectedBuild: request.instance.exactBuild,
      ...(request.sourceProbes ? { sourceProbes: request.sourceProbes } : {}),
    });
    const validation = validateGitLabProfile({
      profile: preflight.profile,
      connection,
      discovery,
      suiteProbes: request.suiteProbes,
      expectedEdition: request.instance.edition,
      expectedVersion: request.instance.exactVersion,
      expectedBuild: request.instance.exactBuild,
    });
    return Object.freeze({ status: validation.status, stage: "DISCOVERY", discovery, validation });
  }
}
