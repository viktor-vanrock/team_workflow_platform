import type { QaAuthorizationBasis, QaExactReference, QaScope } from "../domain/primitives.ts";
import {
  createAutomationSuiteDraft,
  createAutomationSuiteHeader,
  publishAutomationSuiteVersion,
  type QaAutomationSuiteContent,
  type QaAutomationSuiteHeader,
  type QaAutomationSuitePublicationEvidence,
  type QaAutomationSuiteValidationReport,
  type QaAutomationSuiteVersion,
} from "../domain/suite-binding.ts";

function sameExact(left: QaExactReference, right: QaExactReference): boolean {
  return (
    left.id === right.id && left.version === right.version && left.contentHash === right.contentHash
  );
}

export interface FullQaSuiteAcceptanceFacts {
  readonly suiteRef: QaExactReference;
  readonly bindingRef: QaExactReference;
  readonly environmentRef: QaExactReference;
  readonly evidencePolicyRef: QaExactReference;
  readonly pipelineContractHash: string;
  readonly safeIssueCodes: readonly string[];
}

export function fullQaSuiteAcceptanceFacts(
  input: Readonly<{
    suite: QaAutomationSuiteVersion;
    bindingRef: QaExactReference;
    environmentRef: QaExactReference;
    evidencePolicyRef: QaExactReference;
    expectedPipelineContractHash: string;
  }>,
): FullQaSuiteAcceptanceFacts {
  const issues: string[] = [];
  if (input.suite.workspaceId.length === 0 || input.suite.projectId.length === 0)
    issues.push("AUTOMATION_SUITE_SCOPE_INVALID");
  if (input.suite.state !== "PUBLISHED") issues.push("AUTOMATION_SUITE_NOT_PUBLISHED");
  if (
    input.suite.content.logicalExecutionContract.contractHash !== input.expectedPipelineContractHash
  )
    issues.push("PIPELINE_CONTRACT_MISMATCH");
  if (
    !input.suite.content.allowedEnvironmentRefs.some(
      (value) =>
        value === input.environmentRef.id ||
        value === `${input.environmentRef.id}@${input.environmentRef.version}`,
    )
  )
    issues.push("AUTOMATION_ENVIRONMENT_NOT_ALLOWED");
  if (
    !input.suite.content.artifactPolicyRef ||
    !sameExact(input.suite.content.artifactPolicyRef, input.evidencePolicyRef)
  )
    issues.push("EVIDENCE_POLICY_MISMATCH");
  return Object.freeze({
    suiteRef: Object.freeze({
      id: input.suite.id,
      version: input.suite.version,
      contentHash: input.suite.contentHash,
    }),
    bindingRef: input.bindingRef,
    environmentRef: input.environmentRef,
    evidencePolicyRef: input.evidencePolicyRef,
    pipelineContractHash: input.suite.content.logicalExecutionContract.contractHash,
    safeIssueCodes: Object.freeze(issues.sort((left, right) => left.localeCompare(right))),
  });
}

export interface AutomationSuiteStore {
  insertHeader(header: QaAutomationSuiteHeader): Promise<void>;
  insertVersion(version: QaAutomationSuiteVersion): Promise<void>;
  headers(
    scope: QaScope,
  ): Promise<
    readonly Pick<
      QaAutomationSuiteHeader,
      | "id"
      | "suiteKey"
      | "currentPublishedVersion"
      | "currentPublishedVersionId"
      | "resourceVersion"
      | "createdBy"
      | "createdAt"
      | "updatedAt"
    >[]
  >;
  versions(
    scope: QaScope,
    suiteBindingId: string,
  ): Promise<
    readonly Pick<
      QaAutomationSuiteVersion,
      | "id"
      | "suiteBindingId"
      | "suiteKey"
      | "version"
      | "state"
      | "content"
      | "contentHash"
      | "validationReportId"
      | "validationReportContentHash"
      | "createdAt"
      | "publishedAt"
      | "retiredAt"
    >[]
  >;
  persistPublication(
    input: Readonly<{
      scope: QaScope;
      previousHeader: QaAutomationSuiteHeader;
      nextHeader: QaAutomationSuiteHeader;
      previousVersions: readonly QaAutomationSuiteVersion[];
      nextVersions: readonly QaAutomationSuiteVersion[];
    }>,
  ): Promise<void>;
}

export interface AutomationSuiteValidationCommandPort {
  enqueue(
    input: Readonly<{
      scope: QaScope;
      version: QaAutomationSuiteVersion;
      actor: QaAutomationSuiteVersion["createdBy"];
      authorizationBasis: QaAuthorizationBasis;
      authorizationBasisHash: string;
      bindingRef: Readonly<{ id: string; version: number }>;
      profileRef: Readonly<{ id: string; version: number }>;
      requestKey: string;
      correlationId: string;
      causationId: string;
      requestedAt: string;
    }>,
  ): Promise<Readonly<{ commandId: string; replayed: boolean }>>;
}

export class ManageAutomationSuiteService {
  constructor(
    private readonly store: AutomationSuiteStore,
    private readonly validationCommands?: AutomationSuiteValidationCommandPort,
  ) {}

  async create(
    input: Readonly<{
      id: string;
      scope: QaScope;
      suiteKey: string;
      content: QaAutomationSuiteContent;
      actor: QaAutomationSuiteVersion["createdBy"];
      createdAt: string;
    }>,
  ): Promise<Readonly<{ header: QaAutomationSuiteHeader; version: QaAutomationSuiteVersion }>> {
    const header = createAutomationSuiteHeader({
      id: input.id,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      suiteKey: input.suiteKey,
      createdBy: input.actor,
      createdAt: input.createdAt,
    });
    const version = createAutomationSuiteDraft({
      header,
      previousVersions: [],
      content: input.content,
      createdBy: input.actor,
      createdAt: input.createdAt,
    });
    await this.store.insertHeader(header);
    await this.store.insertVersion(version);
    return Object.freeze({ header, version });
  }

  async enqueueValidation(input: Parameters<AutomationSuiteValidationCommandPort["enqueue"]>[0]) {
    if (!this.validationCommands)
      throw new Error("QA_AUTOMATION_SUITE_VALIDATION_COMMAND_PORT_REQUIRED");
    if (input.version.state !== "DRAFT")
      throw new Error("QA_AUTOMATION_SUITE_VALIDATION_STATE_INVALID");
    return await this.validationCommands.enqueue(input);
  }

  async list(scope: QaScope) {
    const headers = await this.store.headers(scope);
    return Object.freeze(
      await Promise.all(
        headers.map(async (header) =>
          Object.freeze({
            header,
            versions: await this.store.versions(scope, header.id),
          }),
        ),
      ),
    );
  }

  async publish(
    input: Readonly<{
      scope: QaScope;
      header: QaAutomationSuiteHeader;
      versions: readonly QaAutomationSuiteVersion[];
      reports: readonly QaAutomationSuiteValidationReport[];
      versionId: string;
      expectedResourceVersion: number;
      evidence: QaAutomationSuitePublicationEvidence;
      publishedAt: string;
    }>,
  ): Promise<
    Readonly<{ header: QaAutomationSuiteHeader; versions: readonly QaAutomationSuiteVersion[] }>
  > {
    const next = publishAutomationSuiteVersion({
      header: input.header,
      versions: input.versions,
      reports: input.reports,
      versionId: input.versionId,
      expectedResourceVersion: input.expectedResourceVersion,
      evidence: input.evidence,
      publishedAt: input.publishedAt,
    });
    await this.store.persistPublication({
      scope: input.scope,
      previousHeader: input.header,
      nextHeader: next.header,
      previousVersions: input.versions,
      nextVersions: next.versions,
    });
    return next;
  }
}
