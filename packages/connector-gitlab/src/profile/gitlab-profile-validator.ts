import {
  designContractRegistry,
  type JsonValue,
  SchemaValidationError,
  sha256,
  type Sha256Digest,
} from "@awp/platform-contracts";

import type { GitLabConnectionConfiguration } from "../auth/gitlab-auth.ts";
import type { GitLabDiscoverySnapshot } from "./gitlab-discovery.ts";

interface GitLabSchemaReference {
  readonly id: string;
  readonly version: number;
  readonly digest: Sha256Digest;
}

interface GitLabProfileInputMapping {
  readonly logicalField: string;
  readonly providerInputName: string;
  readonly inputType: "STRING" | "INTEGER" | "BOOLEAN";
  readonly source: "SERVER_CONTEXT" | "SUITE_PARAMETER";
  readonly allowedValues?: readonly (string | number | boolean)[];
}

export interface GitLabProfileSuiteMapping {
  readonly suiteKey: string;
  readonly logicalPipelineKey: string;
  readonly sourceRefPolicyRef: string;
  readonly resultJobKey: string;
  readonly logicalExecutionContractHash: Sha256Digest;
  readonly resultJobName: string;
  readonly resultArtifactPath: string;
  readonly allowedEnvironmentRefs: readonly string[];
}

export interface GitLabProfileConfiguration {
  readonly schemaVersion: "gitlab-profile-configuration@1.0.0";
  readonly numericGitLabProjectId: number;
  readonly apiFamily: "v4";
  readonly credentialRoutingMode: "NAMED_CONNECTION_SLOTS_V1";
  readonly allowedRefs: readonly string[];
  readonly sourceContext: Readonly<{ mergeRequestRead: true; commitRead: true; buildRead: true }>;
  readonly trigger: Readonly<{
    logicalPipelineKey: string;
    sourceRefPolicyRef: string;
    dialect: "TYPED_INPUTS" | "BOUNDED_VARIABLES";
    ref: string;
    pipelineNameTemplate: "awp:{attemptId}:{requestHash}";
    markerInputName: string;
    allowedInputNames: readonly string[];
    inputMappings: readonly GitLabProfileInputMapping[];
    inputMappingHash: Sha256Digest;
  }>;
  readonly suiteMappings: readonly GitLabProfileSuiteMapping[];
  readonly resultContract: Readonly<{ schemaRef: GitLabSchemaReference; maxBytes: number }>;
  readonly artifactPolicy: Readonly<{
    policyRef: string;
    maxArtifactBytes: number;
    allowedClassifications: readonly string[];
    checksumAlgorithm: "SHA-256";
  }>;
  readonly webhook: Readonly<{
    verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256";
    deliverySemantics: "AT_LEAST_ONCE_SIGNAL_ONLY";
    eventKinds: readonly ("PIPELINE_HOOK" | "JOB_HOOK")[];
    freshnessSeconds: number;
    dedupeHorizonSeconds: number;
  }>;
  readonly reconciliation: Readonly<Record<string, JsonValue>>;
  readonly ratePolicy: Readonly<Record<string, JsonValue>>;
  readonly normalizedInfrastructureCodes: readonly string[];
  readonly transportRetry: Readonly<Record<string, JsonValue>>;
  readonly productionDenied: true;
}

export interface GitLabSuiteProbe {
  readonly suiteKey: string;
  readonly exactRef: string;
  readonly logicalExecutionContractHash: Sha256Digest;
  readonly sourceRevisions?: readonly Readonly<{
    kind: "MERGE_REQUEST" | "COMMIT";
    revision: string;
  }>[];
  readonly result: Readonly<{
    jobName: string;
    artifactPath: string;
    schemaRef: GitLabSchemaReference;
    fixtureValid: boolean;
    fixtureBytes: number;
  }>;
  readonly artifacts: readonly Readonly<{
    mediaType: string;
    byteSize: number;
    classification: string;
    checksumAlgorithm: "SHA-256";
    checksumVerified: boolean;
  }>[];
  readonly allowedEnvironmentRefs: readonly string[];
  readonly runnerReady: boolean;
  readonly networkReady: boolean;
  readonly noDeployAttested: boolean;
}

export interface GitLabProfileValidationIssue {
  readonly code: string;
  readonly subject: "CONNECTION" | "PROFILE" | "DISCOVERY" | "SUITE";
  readonly suiteKeyHash?: Sha256Digest;
}

export interface GitLabProfileValidationResult {
  readonly status: "VALID" | "INVALID";
  readonly issues: readonly GitLabProfileValidationIssue[];
  readonly checks: Readonly<{
    connectionIdentityRouting: boolean;
    instancePins: boolean;
    projectScope: boolean;
    sourceFacts: boolean;
    ciLint: boolean;
    nonProduction: boolean;
    resultContracts: boolean;
    artifactPolicies: boolean;
  }>;
  readonly discoverySnapshotHash: Sha256Digest;
  readonly suiteProbeSetHash: Sha256Digest;
  readonly evidenceHash: Sha256Digest;
}

export interface GitLabProfileValidationInput {
  readonly profile: unknown;
  readonly discovery: GitLabDiscoverySnapshot;
  readonly suiteProbes: readonly GitLabSuiteProbe[];
  readonly connection?: GitLabConnectionConfiguration;
  readonly expectedEdition?: "CE" | "EE";
  readonly expectedVersion?: string;
  readonly expectedBuild?: string;
}

export interface GitLabProfilePreflightResult {
  readonly status: "SAFE_TO_DISCOVER" | "DENIED";
  readonly issues: readonly GitLabProfileValidationIssue[];
  readonly profile?: GitLabProfileConfiguration;
}

function validatedProfile(value: unknown): GitLabProfileConfiguration | undefined {
  try {
    return designContractRegistry.validateById(
      "urn:awp:schemas:005:gitlab-profile-configuration:v1",
      value,
    ) as GitLabProfileConfiguration;
  } catch (error) {
    if (error instanceof SchemaValidationError) return undefined;
    throw error;
  }
}

function safeParameterValue(value: string | number | boolean): boolean {
  return (
    typeof value !== "string" ||
    (!/[\r\n;&|`$<>]/u.test(value) && !/^(?:secretref|https?):\/\//iu.test(value))
  );
}

function productionLike(value: string): boolean {
  return /(?:^|[._:/-])(?:deploy|deployment|production|prod)(?:$|[._:/-])/iu.test(value);
}

function equalSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function sameSchema(left: GitLabSchemaReference, right: GitLabSchemaReference): boolean {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}

function connectionRoutingValid(connection: GitLabConnectionConfiguration | undefined): boolean {
  if (!connection) return true;
  const routing = connection.operationIdentityRouting;
  return (
    routing.mergeRequestRead === "READ" &&
    routing.commitRead === "READ" &&
    routing.buildRead === "READ" &&
    routing.pipelineTrigger === "TRIGGER" &&
    routing.pipelineRead === "READ" &&
    routing.pipelineLookup === "READ" &&
    routing.artifactMetadata === "READ" &&
    routing.artifactStream === "READ" &&
    routing.webhookVerify === "WEBHOOK" &&
    new Set(Object.values(connection.identityReferences).map(({ reference }) => reference)).size ===
      3 &&
    new Set(
      Object.values(connection.identityReferences).map(
        ({ referenceFingerprint }) => referenceFingerprint,
      ),
    ).size === 3
  );
}

function issue(
  code: string,
  subject: GitLabProfileValidationIssue["subject"],
  suiteKey?: string,
): GitLabProfileValidationIssue {
  return Object.freeze({
    code,
    subject,
    ...(suiteKey === undefined ? {} : { suiteKeyHash: sha256(suiteKey) }),
  });
}

/**
 * Pure preflight used before secret resolution or provider I/O. Discovery is
 * allowed only after static production/deploy, input and identity boundaries
 * are proven from the closed candidate configuration.
 */
export function preflightGitLabProfile(
  value: unknown,
  connection?: GitLabConnectionConfiguration,
): GitLabProfilePreflightResult {
  const profile = validatedProfile(value);
  if (!profile)
    return Object.freeze({
      status: "DENIED",
      issues: Object.freeze([issue("GITLAB_PROFILE_SCHEMA_INVALID", "PROFILE")]),
    });
  const issues: GitLabProfileValidationIssue[] = [];
  if (!connectionRoutingValid(connection))
    issues.push(issue("GITLAB_CONNECTION_IDENTITY_ROUTING_INVALID", "CONNECTION"));
  if (
    !profile.productionDenied ||
    productionLike(profile.trigger.ref) ||
    profile.suiteMappings.some(
      ({ resultJobName, allowedEnvironmentRefs }) =>
        productionLike(resultJobName) || allowedEnvironmentRefs.some(productionLike),
    )
  ) {
    issues.push(issue("GITLAB_PRODUCTION_OR_DEPLOY_REACHABLE", "PROFILE"));
  }
  const markerMappings = profile.trigger.inputMappings.filter(
    ({ providerInputName }) => providerInputName === profile.trigger.markerInputName,
  );
  if (
    new Set(profile.trigger.allowedInputNames).size !== profile.trigger.allowedInputNames.length ||
    profile.trigger.inputMappings.some(
      ({ providerInputName, allowedValues }) =>
        !profile.trigger.allowedInputNames.includes(providerInputName) ||
        !(allowedValues ?? []).every(safeParameterValue),
    ) ||
    markerMappings.length !== 1 ||
    markerMappings[0]?.logicalField !== "REQUEST_MARKER" ||
    markerMappings[0].source !== "SERVER_CONTEXT"
  ) {
    issues.push(issue("GITLAB_TRIGGER_INPUT_POLICY_INVALID", "PROFILE"));
  }
  if (!profile.allowedRefs.includes(profile.trigger.ref))
    issues.push(issue("GITLAB_TRIGGER_REF_INVALID", "PROFILE"));
  if (
    new Set(profile.suiteMappings.map(({ suiteKey }) => suiteKey)).size !==
    profile.suiteMappings.length
  ) {
    issues.push(issue("GITLAB_SUITE_MAPPING_DUPLICATE", "PROFILE"));
  }
  return Object.freeze({
    status: issues.length === 0 ? "SAFE_TO_DISCOVER" : "DENIED",
    issues: Object.freeze(issues),
    ...(issues.length === 0 ? { profile } : {}),
  });
}

function probeValid(
  profile: GitLabProfileConfiguration,
  mapping: GitLabProfileSuiteMapping,
  probe: GitLabSuiteProbe,
  discovery: GitLabDiscoverySnapshot,
): Readonly<{ source: boolean; result: boolean; artifact: boolean; nonProduction: boolean }> {
  const source = (probe.sourceRevisions ?? []).every(({ kind, revision }) =>
    discovery.sourceFacts.some((fact) => fact.kind === kind && fact.revision === revision),
  );
  const result =
    probe.exactRef === profile.trigger.ref &&
    probe.logicalExecutionContractHash === mapping.logicalExecutionContractHash &&
    probe.result.jobName === mapping.resultJobName &&
    probe.result.artifactPath === mapping.resultArtifactPath &&
    sameSchema(probe.result.schemaRef, profile.resultContract.schemaRef) &&
    probe.result.fixtureValid &&
    Number.isSafeInteger(probe.result.fixtureBytes) &&
    probe.result.fixtureBytes > 0 &&
    probe.result.fixtureBytes <= profile.resultContract.maxBytes &&
    discovery.lint.jobs.filter(({ name }) => name === mapping.resultJobName).length === 1;
  const artifact =
    probe.artifacts.length > 0 &&
    probe.artifacts.length <= 64 &&
    probe.artifacts.every(
      (candidate) =>
        Number.isSafeInteger(candidate.byteSize) &&
        candidate.byteSize > 0 &&
        candidate.byteSize <= profile.artifactPolicy.maxArtifactBytes &&
        profile.artifactPolicy.allowedClassifications.includes(candidate.classification) &&
        candidate.checksumAlgorithm === "SHA-256" &&
        candidate.checksumVerified,
    );
  const nonProduction =
    probe.noDeployAttested &&
    probe.runnerReady &&
    probe.networkReady &&
    !probe.allowedEnvironmentRefs.some(productionLike) &&
    equalSet(probe.allowedEnvironmentRefs, mapping.allowedEnvironmentRefs);
  return Object.freeze({ source, result, artifact, nonProduction });
}

function invalidProfileResult(discovery: GitLabDiscoverySnapshot): GitLabProfileValidationResult {
  const issues = Object.freeze([issue("GITLAB_PROFILE_SCHEMA_INVALID", "PROFILE")]);
  const checks = Object.freeze({
    connectionIdentityRouting: false,
    instancePins: false,
    projectScope: false,
    sourceFacts: false,
    ciLint: false,
    nonProduction: false,
    resultContracts: false,
    artifactPolicies: false,
  });
  const suiteProbeSetHash = sha256([]);
  return Object.freeze({
    status: "INVALID",
    issues,
    checks,
    discoverySnapshotHash: discovery.contentHash,
    suiteProbeSetHash,
    evidenceHash: sha256({
      checks,
      discoverySnapshotHash: discovery.contentHash,
      issues,
      suiteProbeSetHash,
    } as unknown as JsonValue),
  });
}

export function validateGitLabProfile(
  input: GitLabProfileValidationInput,
): GitLabProfileValidationResult {
  const profile = validatedProfile(input.profile);
  if (!profile) return invalidProfileResult(input.discovery);
  if (input.suiteProbes.length > 32) throw new Error("GITLAB_SUITE_PROBE_LIMIT_EXCEEDED");

  const issues: GitLabProfileValidationIssue[] = [];
  const connectionIdentityRouting = connectionRoutingValid(input.connection);
  if (!connectionIdentityRouting)
    issues.push(issue("GITLAB_CONNECTION_IDENTITY_ROUTING_INVALID", "CONNECTION"));

  const instancePins =
    input.discovery.apiFamily === profile.apiFamily &&
    (input.expectedEdition === undefined || input.discovery.edition === input.expectedEdition) &&
    (input.expectedVersion === undefined ||
      input.discovery.exactVersion === input.expectedVersion) &&
    (input.expectedBuild === undefined || input.discovery.exactBuild === input.expectedBuild);
  if (!instancePins) issues.push(issue("GITLAB_INSTANCE_PIN_MISMATCH", "DISCOVERY"));

  const projectScope =
    input.discovery.numericProjectId === profile.numericGitLabProjectId &&
    !input.discovery.projectArchived;
  if (!projectScope) issues.push(issue("GITLAB_PROJECT_SCOPE_INVALID", "DISCOVERY"));
  if (
    !profile.allowedRefs.includes(profile.trigger.ref) ||
    input.discovery.exactRef !== profile.trigger.ref
  ) {
    issues.push(issue("GITLAB_TRIGGER_REF_INVALID", "PROFILE"));
  }

  const capabilities = input.discovery.capabilities;
  const sourceFacts =
    capabilities.projectRead &&
    capabilities.sourceRead &&
    profile.sourceContext.mergeRequestRead &&
    profile.sourceContext.commitRead &&
    profile.sourceContext.buildRead;
  if (!sourceFacts) issues.push(issue("GITLAB_SOURCE_CAPABILITY_UNSUPPORTED", "DISCOVERY"));

  const ciLint =
    input.discovery.lint.valid &&
    capabilities.ciLintDryRun &&
    capabilities.ciLintIncludeJobs &&
    capabilities.pipelineRead &&
    capabilities.pipelineTrigger &&
    capabilities.artifactRead &&
    capabilities.standardWebhookHmacSha256;
  if (!ciLint) issues.push(issue("GITLAB_DISCOVERY_CAPABILITY_INVALID", "DISCOVERY"));

  const markerMappings = profile.trigger.inputMappings.filter(
    ({ providerInputName }) => providerInputName === profile.trigger.markerInputName,
  );
  const inputsSafe =
    new Set(profile.trigger.allowedInputNames).size === profile.trigger.allowedInputNames.length &&
    profile.trigger.inputMappings.every(
      ({ providerInputName, allowedValues }) =>
        profile.trigger.allowedInputNames.includes(providerInputName) &&
        (allowedValues ?? []).every(safeParameterValue),
    ) &&
    markerMappings.length === 1 &&
    markerMappings[0]?.logicalField === "REQUEST_MARKER" &&
    markerMappings[0].source === "SERVER_CONTEXT";
  if (!inputsSafe) issues.push(issue("GITLAB_TRIGGER_INPUT_POLICY_INVALID", "PROFILE"));

  const duplicateSuiteKeys =
    new Set(profile.suiteMappings.map(({ suiteKey }) => suiteKey)).size !==
    profile.suiteMappings.length;
  if (duplicateSuiteKeys) issues.push(issue("GITLAB_SUITE_MAPPING_DUPLICATE", "PROFILE"));
  const probesBySuite = new Map<string, GitLabSuiteProbe[]>();
  for (const probe of input.suiteProbes)
    probesBySuite.set(probe.suiteKey, [...(probesBySuite.get(probe.suiteKey) ?? []), probe]);

  let suiteSourcesValid = true;
  let resultContracts = true;
  let artifactPolicies = true;
  let suiteNonProduction = true;
  for (const mapping of profile.suiteMappings) {
    const probes = probesBySuite.get(mapping.suiteKey) ?? [];
    if (probes.length !== 1) {
      issues.push(issue("GITLAB_SUITE_PROBE_CARDINALITY_INVALID", "SUITE", mapping.suiteKey));
      suiteSourcesValid = false;
      resultContracts = false;
      artifactPolicies = false;
      suiteNonProduction = false;
      continue;
    }
    const result = probeValid(profile, mapping, probes[0]!, input.discovery);
    if (!result.source)
      issues.push(issue("GITLAB_SUITE_SOURCE_FACT_INVALID", "SUITE", mapping.suiteKey));
    if (!result.result)
      issues.push(issue("GITLAB_SUITE_RESULT_CONTRACT_INVALID", "SUITE", mapping.suiteKey));
    if (!result.artifact)
      issues.push(issue("GITLAB_SUITE_ARTIFACT_POLICY_INVALID", "SUITE", mapping.suiteKey));
    if (!result.nonProduction)
      issues.push(issue("GITLAB_SUITE_NON_PRODUCTION_PROOF_INVALID", "SUITE", mapping.suiteKey));
    suiteSourcesValid &&= result.source;
    resultContracts &&= result.result;
    artifactPolicies &&= result.artifact;
    suiteNonProduction &&= result.nonProduction;
  }
  if (
    [...probesBySuite.keys()].some(
      (suiteKey) => !profile.suiteMappings.some((mapping) => mapping.suiteKey === suiteKey),
    )
  ) {
    issues.push(issue("GITLAB_SUITE_PROBE_UNKNOWN", "SUITE"));
    resultContracts = false;
  }

  const nonProduction =
    profile.productionDenied &&
    input.discovery.productionDenied &&
    !input.discovery.lint.productionOrDeployReachable &&
    !profile.suiteMappings.some(
      ({ resultJobName, allowedEnvironmentRefs }) =>
        productionLike(resultJobName) || allowedEnvironmentRefs.some(productionLike),
    ) &&
    suiteNonProduction;
  if (!nonProduction) issues.push(issue("GITLAB_PRODUCTION_OR_DEPLOY_REACHABLE", "PROFILE"));

  const checks = Object.freeze({
    connectionIdentityRouting,
    instancePins,
    projectScope,
    sourceFacts: sourceFacts && suiteSourcesValid,
    ciLint: ciLint && inputsSafe,
    nonProduction,
    resultContracts,
    artifactPolicies,
  });
  const suiteProbeSetHash = sha256(input.suiteProbes as unknown as JsonValue);
  const frozenIssues = Object.freeze(issues.slice(0, 64));
  const evidenceInput = Object.freeze({
    checks,
    discoverySnapshotHash: input.discovery.contentHash,
    issues: frozenIssues,
    suiteProbeSetHash,
  });
  return Object.freeze({
    status: issues.length === 0 && Object.values(checks).every(Boolean) ? "VALID" : "INVALID",
    issues: frozenIssues,
    checks,
    discoverySnapshotHash: input.discovery.contentHash,
    suiteProbeSetHash,
    evidenceHash: sha256(evidenceInput as unknown as JsonValue),
  });
}

export class GitLabProfileValidator {
  validate(input: GitLabProfileValidationInput): GitLabProfileValidationResult {
    return validateGitLabProfile(input);
  }
}
