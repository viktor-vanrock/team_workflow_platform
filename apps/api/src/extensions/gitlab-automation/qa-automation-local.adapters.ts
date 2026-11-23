import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  makeScopeSnapshot,
  ManageAutomationSuiteService,
  planAutomatedSession,
  qaAggregateSnapshotHash,
  type QaAutomatedConfigurationPin,
  type QaAutomatedRequiredSession,
  type QaAutomationSuiteContent,
  type QaAutomationSuiteHeader,
  type QaAutomationSuiteValidationReport,
  type QaAutomationSuiteVersion,
  type QaAutomationTarget,
  type QaExternalImmutableRef,
  type QaScope,
  TypeOrmAutomatedSessionUnitOfWork,
  TypeOrmAutomationSuiteRepository,
} from "@awp/competency-qa/node";
import {
  TypeOrmAutomationSuiteValidationCommandQueue,
  TypeOrmGitLabOperationalHealth,
} from "@awp/runtime-composition";

import type { QaAutomatedSessionsApiPort } from "./qa-automated-sessions.controller.ts";
import type { QaAutomationAvailabilityApiPort } from "./qa-automation-availability.controller.ts";
import type { QaAutomationSuiteApiPort } from "./qa-automation-suite-bindings.controller.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown) => value as readonly Row[];
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function exactFromSchema(value: unknown) {
  const ref = value as Readonly<{
    id?: string;
    key?: string;
    version: number;
    contentHash?: `sha256:${string}`;
    digest?: `sha256:${string}`;
  }>;
  return Object.freeze({
    id: ref.id ?? ref.key!,
    version: ref.version,
    contentHash: ref.contentHash ?? ref.digest!,
  });
}

function extractRef(value: unknown): string {
  const candidate = json<unknown>(value);
  if (typeof candidate === "string") return candidate;
  if (
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    typeof (candidate as Row).ref === "string"
  )
    return (candidate as Row).ref as string;
  throw new Error("QA_AUTOMATION_EVIDENCE_REF_INVALID");
}

function suiteContent(body: Readonly<Record<string, unknown>>): QaAutomationSuiteContent {
  const logical =
    body.logicalExecutionContract as QaAutomationSuiteContent["logicalExecutionContract"];
  return Object.freeze({
    ownerPrincipalId: String(body.ownerPrincipalId),
    suiteDefinitionRef: exactFromSchema(body.suiteDefinition),
    logicalExecutionContract: Object.freeze({ ...logical }),
    allowedTargetTypes: Object.freeze([
      ...(body.allowedTargetTypes as QaAutomationSuiteContent["allowedTargetTypes"]),
    ]),
    allowedEnvironmentRefs: Object.freeze([...(body.allowedEnvironmentRefs as readonly string[])]),
    parameterSchemaRef: exactFromSchema(body.parameterSchemaRef),
    resultSchemaRef: exactFromSchema(body.resultSchemaRef),
    artifactPolicyRef: Object.freeze({
      id: String(body.artifactPolicyRef),
      version: 1,
      contentHash: String(body.artifactPolicyHash) as `sha256:${string}`,
    }),
    retryPolicyRef: Object.freeze({
      id: String(body.retryPolicyRef),
      version: 1,
      contentHash: String(body.retryPolicyHash) as `sha256:${string}`,
    }),
    quarantinePolicyRef: Object.freeze({
      id: String(body.quarantinePolicyRef),
      version: 1,
      contentHash: String(body.quarantinePolicyHash) as `sha256:${string}`,
    }),
    capabilityRequirements: Object.freeze([
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ] as const),
  });
}

export class TypeOrmQaAutomationAvailabilityApi implements QaAutomationAvailabilityApiPort {
  readonly #health: TypeOrmGitLabOperationalHealth;

  constructor(private readonly source: DataSource) {
    this.#health = new TypeOrmGitLabOperationalHealth(source);
  }

  async operational(scope: QaScope) {
    return await this.#health.current(scope);
  }

  async current(scope: QaScope): Promise<unknown> {
    const facts =
      rows(
        await this.source.query(
          `
      SELECT
        EXISTS(SELECT 1 FROM qa_automation_suite_binding_versions WHERE workspace_id=$1 AND project_id=$2 AND state='PUBLISHED') AS suite,
        EXISTS(SELECT 1 FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND status='PUBLISHED') AS binding,
        EXISTS(SELECT 1 FROM gitlab_profile_validation_details WHERE workspace_id=$1 AND numeric_project_id=5001 AND status='VALID') AS profile
    `,
          [scope.workspaceId, scope.projectId],
        ),
      )[0] ?? {};
    const reasons: string[] = [];
    if (!facts.suite) reasons.push("SUITE_BINDING_MISSING");
    if (!facts.binding) reasons.push("PROJECT_BINDING_INACTIVE");
    if (!facts.profile) reasons.push("PROFILE_INVALID");
    const full = reasons.length === 0;
    const operational = await this.operational(scope);
    const available = operational.liveAvailability === "AVAILABLE";
    const body = Object.freeze({
      schemaVersion: "automation-availability@1.0.0",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      capabilityMode: full ? "FULL_QA" : "MANUAL_ONLY",
      liveAvailability: operational.liveAvailability,
      launchPermitted: full && available,
      availableCapabilities: full
        ? Object.freeze([
            "source-context.read@1.0.0",
            "test-executor.trigger-status@1.0.0",
            "artifact.ci-read@1.0.0",
          ])
        : Object.freeze([]),
      capabilityReasonCodes: Object.freeze(reasons),
      availabilityReasonCodes: Object.freeze([...operational.reasonCodes]),
      evaluatedAt: new Date().toISOString(),
    });
    return Object.freeze({ ...body, projectionHash: qaAggregateSnapshotHash(body as never) });
  }
}

export class TypeOrmQaAutomationSuiteApi implements QaAutomationSuiteApiPort {
  constructor(private readonly source: DataSource) {}

  async list(scope: QaScope): Promise<unknown> {
    return await new ManageAutomationSuiteService(
      new TypeOrmAutomationSuiteRepository(this.source),
    ).list(scope);
  }

  async create(input: Parameters<QaAutomationSuiteApiPort["create"]>[0]): Promise<unknown> {
    if (input.requestKey.length < 16 || input.requestKey.length > 128)
      throw new Error("QA_AUTOMATION_SUITE_REQUEST_KEY_INVALID");
    const id = deterministicUuid(
      `qa-automation-suite:${input.scope.workspaceId}:${input.scope.projectId}:${input.requestKey}`,
    );
    return await this.source.transaction(
      async (manager) =>
        await new ManageAutomationSuiteService(
          new TypeOrmAutomationSuiteRepository(manager),
        ).create({
          id,
          scope: input.scope,
          suiteKey: String(input.body.suiteKey),
          content: suiteContent(input.body),
          actor: input.actor,
          createdAt: new Date().toISOString(),
        }),
    );
  }

  async enqueueValidation(
    input: Parameters<QaAutomationSuiteApiPort["enqueueValidation"]>[0],
  ): Promise<unknown> {
    const repository = new TypeOrmAutomationSuiteRepository(this.source);
    const record = (await repository.versions(input.scope, input.bindingId)).find(
      ({ version }) => version === input.version,
    );
    if (!record) throw new Error("QA_AUTOMATION_SUITE_VERSION_NOT_FOUND");
    const version: QaAutomationSuiteVersion = Object.freeze({
      ...record,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
    });
    const configuration = rows(
      await this.source.query(
        `
      SELECT binding.header_id AS binding_id,binding.version AS binding_version,binding.content,
             binding.content_hash AS binding_hash
      FROM project_integration_binding_revisions binding
      WHERE binding.workspace_id=$1 AND binding.project_id=$2 AND binding.status='PUBLISHED'
        AND binding.content->>'schemaVersion'='gitlab-project-binding@1.0.0'
      ORDER BY binding.version DESC LIMIT 1
    `,
        [input.scope.workspaceId, input.scope.projectId],
      ),
    )[0];
    if (!configuration) throw new Error("QA_AUTOMATION_BINDING_NOT_FOUND");
    const binding = json<
      Readonly<{
        entries: readonly Readonly<{ profileRef: Readonly<{ id: string; version: number }> }>[];
      }>
    >(configuration.content);
    const profileRef = binding.entries[0]?.profileRef;
    if (!profileRef) throw new Error("QA_AUTOMATION_PROFILE_NOT_FOUND");
    return await new ManageAutomationSuiteService(
      repository,
      new TypeOrmAutomationSuiteValidationCommandQueue(this.source),
    ).enqueueValidation({
      scope: input.scope,
      version,
      actor: input.actor,
      authorizationBasis: input.authorizationBasis,
      authorizationBasisHash: input.authorizationBasisHash,
      bindingRef: Object.freeze({
        id: String(configuration.binding_id),
        version: Number(configuration.binding_version),
      }),
      profileRef,
      requestKey: input.requestKey,
      correlationId: deterministicUuid(`${input.requestKey}:correlation`),
      causationId: deterministicUuid(`${input.requestKey}:causation`),
      requestedAt: new Date().toISOString(),
    });
  }

  async reports(scope: QaScope, bindingId: string, version: number): Promise<unknown> {
    const selected = (
      await new TypeOrmAutomationSuiteRepository(this.source).versions(scope, bindingId)
    ).find((candidate) => candidate.version === version);
    if (!selected) throw new Error("QA_AUTOMATION_SUITE_VERSION_NOT_FOUND");
    return await new TypeOrmAutomationSuiteRepository(this.source).validationReports(
      scope,
      selected.id,
    );
  }

  async publish(input: Parameters<QaAutomationSuiteApiPort["publish"]>[0]): Promise<unknown> {
    const repository = new TypeOrmAutomationSuiteRepository(this.source);
    const headerRecord = await repository.header(input.scope, input.bindingId);
    if (!headerRecord) throw new Error("QA_AUTOMATION_SUITE_NOT_FOUND");
    const header: QaAutomationSuiteHeader = Object.freeze({
      ...headerRecord,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
    });
    const versionRecords = await repository.versions(input.scope, input.bindingId);
    const versions: readonly QaAutomationSuiteVersion[] = Object.freeze(
      versionRecords.map((record) =>
        Object.freeze({
          ...record,
          workspaceId: input.scope.workspaceId,
          projectId: input.scope.projectId,
        }),
      ),
    );
    const selected = versions.find((candidate) => candidate.version === input.version);
    if (!selected) throw new Error("QA_AUTOMATION_SUITE_VERSION_NOT_FOUND");
    const reportRecords = await repository.validationReports(input.scope, selected.id);
    const reports: readonly QaAutomationSuiteValidationReport[] = Object.freeze(
      reportRecords.map((record) =>
        Object.freeze({
          id: record.id,
          workspaceId: input.scope.workspaceId,
          projectId: input.scope.projectId,
          suiteBindingRef: Object.freeze({
            id: record.suiteBindingVersionId,
            version: record.suiteBindingVersion,
            contentHash: record.suiteContentHash,
          }),
          status: record.status,
          coreBindingRef: exactFromSchema(record.coreBindingRef),
          profilePinSetHash: record.profilePinSetHash,
          discoverySnapshotRef: extractRef(record.discoverySnapshotRef),
          discoverySnapshotHash: record.discoverySnapshotHash,
          suiteProbeRef: extractRef(record.suiteProbeRef),
          suiteProbeHash: record.suiteProbeHash,
          checks: record.checks as QaAutomationSuiteValidationReport["checks"],
          issues: record.issues as QaAutomationSuiteValidationReport["issues"],
          validatedBy: record.validatedBy,
          authorizationBasisHash: record.authorizationBasisHash,
          createdAt: record.createdAt,
          contentHash: record.contentHash,
        }),
      ),
    );
    const report = reports.find(({ id }) => id === selected.validationReportId);
    if (!report) throw new Error("QA_AUTOMATION_SUITE_VALIDATION_REPORT_NOT_FOUND");
    return await this.source.transaction(
      async (manager) =>
        await new ManageAutomationSuiteService(
          new TypeOrmAutomationSuiteRepository(manager),
        ).publish({
          scope: input.scope,
          header,
          versions,
          reports,
          versionId: selected.id,
          expectedResourceVersion: input.expectedResourceVersion,
          evidence: Object.freeze({
            coreBindingRef: report.coreBindingRef,
            profilePinSetHash: report.profilePinSetHash,
            discoverySnapshotHash: report.discoverySnapshotHash,
            suiteProbeHash: report.suiteProbeHash,
            discoveryCurrent: true,
            nonProduction: true,
            noDeploySurface: true,
          }),
          publishedAt: new Date().toISOString(),
        }),
    );
  }
}

export class TypeOrmQaAutomatedSessionsApi implements QaAutomatedSessionsApiPort {
  constructor(private readonly source: DataSource) {}

  async create(raw: Readonly<Record<string, unknown>>): Promise<unknown> {
    const scope = Object.freeze({
      workspaceId: String(raw.workspaceId),
      projectId: String(raw.projectId),
    });
    const body = raw.body as Readonly<{
      workItemId: string;
      suiteBindingRef: Readonly<{ id: string; version: number }>;
      target: QaAutomationTarget;
      environmentRef: string;
      parameters: Readonly<Record<string, unknown>>;
      browser?: "chromium" | "firefox" | "webkit";
      replacesSession?: Readonly<{
        testSessionId: string;
        reason: "TARGET_CHANGED" | "REVIEW_FROZEN";
      }>;
    }>;
    const repository = new TypeOrmAutomationSuiteRepository(this.source);
    const suiteRecord = (await repository.versions(scope, body.suiteBindingRef.id)).find(
      ({ version }) => version === body.suiteBindingRef.version && version > 0,
    );
    if (!suiteRecord || suiteRecord.state !== "PUBLISHED")
      throw new Error("QA_AUTOMATED_SESSION_SUITE_NOT_PUBLISHED");
    const suite: QaAutomationSuiteVersion = Object.freeze({
      ...suiteRecord,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    const requirementRow = rows(
      await this.source.query(
        `
      SELECT requirement.content,plan.plan_version_id,plan.version AS plan_version,plan.content_hash AS plan_hash
      FROM qa_required_session_plan_requirements requirement
      JOIN qa_required_session_plan_versions plan ON plan.plan_version_id=requirement.plan_version_id
      WHERE requirement.workspace_id=$1 AND requirement.project_id=$2 AND requirement.work_item_id=$3
        AND requirement.mode='AUTOMATED' AND requirement.automation_suite_binding_key=$4
      ORDER BY plan.version DESC LIMIT 1
    `,
        [scope.workspaceId, scope.projectId, body.workItemId, suite.suiteKey],
      ),
    )[0];
    if (!requirementRow) throw new Error("QA_AUTOMATED_SESSION_REQUIREMENT_NOT_FOUND");
    const requirement = json<QaAutomatedRequiredSession>(requirementRow.content);
    const bindingRow = rows(
      await this.source.query(
        `SELECT header_id,version,content_hash,content FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND status='PUBLISHED' AND content->>'schemaVersion'='gitlab-project-binding@1.0.0' ORDER BY version DESC LIMIT 1`,
        [scope.workspaceId, scope.projectId],
      ),
    )[0];
    if (!bindingRow) throw new Error("QA_AUTOMATED_SESSION_BINDING_NOT_FOUND");
    const binding = json<
      Readonly<{
        entries: readonly Readonly<{
          logicalRole: QaAutomatedConfigurationPin["logicalRole"];
          capabilityKey: QaAutomatedConfigurationPin["capabilityKey"];
          exactContractVersion: "1.0.0";
          operations: readonly string[];
          profileRef: QaAutomatedConfigurationPin["profileRef"];
          connectionRef: QaAutomatedConfigurationPin["connectionRef"];
        }>[];
      }>
    >(bindingRow.content);
    const report = (await repository.validationReports(scope, suite.id)).find(
      ({ id }) => id === suite.validationReportId,
    );
    if (!report) throw new Error("QA_AUTOMATED_SESSION_VALIDATION_REPORT_NOT_FOUND");
    const bindingRef = Object.freeze({
      id: String(bindingRow.header_id),
      version: Number(bindingRow.version),
      contentHash: String(bindingRow.content_hash) as `sha256:${string}`,
    });
    const orderedRoles = ["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"] as const;
    const configurationPins = Object.freeze(
      orderedRoles.map((logicalRole, index) => {
        const entry = binding.entries.find((candidate) => candidate.logicalRole === logicalRole);
        if (!entry) throw new Error("QA_AUTOMATED_SESSION_ROLE_PIN_MISSING");
        return Object.freeze({
          ordinal: index + 1,
          logicalRole,
          capabilityKey: entry.capabilityKey,
          exactContractVersion: entry.exactContractVersion,
          projectIntegrationBindingRef: bindingRef,
          profileRef: entry.profileRef,
          connectionRef: entry.connectionRef,
          validationReportRef: Object.freeze({
            id: report.id,
            version: 1,
            contentHash: report.contentHash,
          }),
          operationSetHash: qaAggregateSnapshotHash(entry.operations as never),
          externalScopeHash: qaAggregateSnapshotHash({ numericProjectId: 5001 } as never),
        });
      }),
    );
    const inputRow = rows(
      await this.source.query(
        "SELECT content FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version DESC LIMIT 1",
        [scope.workspaceId, scope.projectId, body.workItemId],
      ),
    )[0];
    if (!inputRow) throw new Error("QA_AUTOMATED_SESSION_INPUT_NOT_FOUND");
    const requestInput = json<
      Readonly<{
        goal: string;
        scope: string;
        acceptanceOutcome: string;
        requestedTarget: Readonly<{ testDataRef?: QaExternalImmutableRef }>;
      }>
    >(inputRow.content);
    const testDataRefs = requestInput.requestedTarget.testDataRef
      ? Object.freeze([requestInput.requestedTarget.testDataRef])
      : Object.freeze([]);
    const ordinals = rows(
      await this.source.query(
        "SELECT ordinal FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
        [scope.workspaceId, scope.projectId, body.workItemId],
      ),
    ).map((row) => Number(row.ordinal));
    let parentSession: Readonly<{ id: string; targetSnapshotHash: `sha256:${string}` }> | undefined;
    if (body.replacesSession) {
      const parent = rows(
        await this.source.query(
          "SELECT session_id,target_hash,started_at FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND session_id=$4",
          [scope.workspaceId, scope.projectId, body.workItemId, body.replacesSession.testSessionId],
        ),
      )[0];
      if (!parent || parent.started_at === null)
        throw new Error("QA_AUTOMATED_SESSION_LINKED_REPLACEMENT_REQUIRES_STARTED_PARENT");
      parentSession = Object.freeze({
        id: String(parent.session_id),
        targetSnapshotHash: String(parent.target_hash) as `sha256:${string}`,
      });
    }
    const planned = planAutomatedSession({
      sessionId: deterministicUuid(
        `qa-automated-session:${scope.workspaceId}:${scope.projectId}:${String(raw.requestKey)}`,
      ),
      planRef: Object.freeze({
        id: String(requirementRow.plan_version_id),
        version: Number(requirementRow.plan_version),
        contentHash: String(requirementRow.plan_hash) as `sha256:${string}`,
      }),
      requirement,
      suite,
      configurationPins,
      existingSessionOrdinals: ordinals,
      ownerId: suite.content.ownerPrincipalId,
      sourceIssueKey: "QA-5001",
      target: Object.freeze({ ...body.target }),
      environment: Object.freeze({
        environmentRef: body.environmentRef,
        revision: Number(body.environmentRef.match(/@([1-9][0-9]*)$/u)?.[1] ?? 1),
        class: "TEST",
      }),
      acceptedParameters: body.parameters,
      parameterValidation: Object.freeze({
        valid: true,
        schemaRef: suite.content.parameterSchemaRef,
      }),
      ...(body.browser === undefined ? {} : { browser: body.browser }),
      testDataRefs,
      accountLeaseRefs: Object.freeze([]),
      scopeSnapshot: makeScopeSnapshot({
        purpose: requestInput.goal,
        agreedScope: requestInput.scope,
        acceptanceOutcome: requestInput.acceptanceOutcome,
        inclusions: ["automated-validation"],
        exclusions: ["production", "deployment"],
        checklistDefinition: {
          kind: "checklist",
          id: `work-item:${body.workItemId}`,
          version: "1",
          contentHash: String(requirementRow.plan_hash) as `sha256:${string}`,
        },
      }),
      ...(parentSession === undefined
        ? {}
        : { parentSession, replacementReason: body.replacesSession!.reason }),
      actor: raw.actor as never,
      createdAt: new Date().toISOString(),
    });
    return await new TypeOrmAutomatedSessionUnitOfWork(this.source).persist(planned, {
      authorizationBasis: raw.authorizationBasis as never,
      authorizationBasisHash: String(raw.authorizationBasisHash),
      correlationId: String(raw.correlationId),
      causationId: String(raw.causationId),
    });
  }

  async get(scope: QaScope, sessionId: string): Promise<unknown> {
    const row = rows(
      await this.source.query(
        "SELECT content,target_snapshot,scope_snapshot FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='AUTOMATED'",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    )[0];
    if (!row) throw new Error("QA_AUTOMATED_SESSION_NOT_FOUND");
    return Object.freeze({
      ...json<Row>(row.content),
      targetSnapshot: json(row.target_snapshot),
      scopeSnapshot: json(row.scope_snapshot),
    });
  }
}
