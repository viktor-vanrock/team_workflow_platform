import {
  createJiraDialect,
  JiraHttpRequestCreatePort,
  JiraRequestCreateService,
  JiraRestClient,
  type RequestCreateObservation,
  type RequestCreatePort,
  type RequestSubEffectStore,
} from "@awp/connector-jira";
import {
  assertOperationalTarget,
  assertSparseRequestCreate,
  type ConnectorRuntimeContext,
  type OperationalRequestCreateInput,
  type OperationalRequestCreateResult,
  type OperationalWorkItemTarget,
} from "@awp/connector-sdk";

import { isQaJiraLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import {
  type QaUs1OperationalBrokerMap,
  qaUs1OperationalRoute,
} from "../qa/operational-composition.ts";
import type { QaJiraResolvedPins } from "./qa-command-materializer.ts";
import {
  planQaJiraRequestSourceContext,
  prepareQaJiraRequestSourceContext,
  type QaJiraSourceContextPlan,
  resolveQaJiraSourceLinkPolicy,
} from "./qa-source-context.ts";

type RecordValue = Readonly<Record<string, unknown>>;

const jiraFieldId =
  /^(?:summary|description|reporter|assignee|priority|duedate|labels|customfield_[1-9][0-9]*)$/u;

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as RecordValue;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function exactFieldId(value: unknown, code: string): string {
  const fieldId = requiredString(value, code);
  if (!jiraFieldId.test(fieldId)) throw new Error(code);
  return fieldId;
}

function exactIdFrom(value: unknown, fallback: unknown, code: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return requiredString((value as RecordValue).id, code);
  }
  return requiredString(fallback, code);
}

function stringArray(value: unknown, code: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string")
  )
    throw new Error(code);
  const result = value.map((entry) => exactFieldId(entry, code));
  if (new Set(result).size !== result.length) throw new Error(code);
  return Object.freeze(result);
}

interface QaJiraPinnedRequestCreateRuntime {
  readonly endpoint: string;
  readonly environment: "LOCAL" | "NON_PROD";
  readonly adapterFamily: "jira-cloud-v3" | "jira-dc-9-v2" | "jira-dc-10-v2" | "jira-dc-11-v2";
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly markerFieldId: string;
  readonly authorityFieldIds: readonly string[];
  readonly projectDiscriminator: string;
  readonly fieldIds: Readonly<{
    summary: string;
    description?: string;
    projectDiscriminator: string;
    acceptanceOutcome?: string;
  }>;
}

function pinnedRequestCreateRuntime(
  resolved: QaJiraResolvedPins,
): QaJiraPinnedRequestCreateRuntime {
  const primary = resolved.entries[0];
  const sourceContext = resolved.entries[1];
  if (
    resolved.entries.length !== 2 ||
    primary?.pin.sequence !== 0 ||
    primary.pin.purpose !== "PRIMARY" ||
    primary.pin.logicalRole !== "QA_REQUEST_AUTHORITY" ||
    sourceContext?.pin.sequence !== 1 ||
    sourceContext.pin.purpose !== "AUXILIARY" ||
    sourceContext.pin.logicalRole !== "SOURCE_CONTEXT"
  )
    throw new Error("JIRA_REQUEST_CREATE_PIN_CHAIN_INVALID");
  if (
    primary.pin.profileRef.id !== resolved.profileRef.id ||
    primary.pin.profileRef.version !== resolved.profileRef.version ||
    primary.pin.mappingRef.id !== resolved.mappingRef.id ||
    primary.pin.mappingRef.version !== resolved.mappingRef.version ||
    primary.pin.connectionRef.id !== resolved.connectionRef.id ||
    primary.pin.connectionRef.version !== resolved.connectionRef.version
  )
    throw new Error("JIRA_REQUEST_CREATE_PRIMARY_PIN_MISMATCH");

  const connection = resolved.connectionContent;
  const profile = resolved.profileContent;
  const mapping = resolved.mappingContent;
  const endpoint = requiredString(
    connection.baseUrl ?? connection.endpoint,
    "JIRA_PINNED_ENDPOINT_REQUIRED",
  );
  const environment = requiredString(
    connection.environment ?? connection.environmentScope,
    "JIRA_PINNED_ENVIRONMENT_REQUIRED",
  );
  if (environment !== "LOCAL" && environment !== "NON_PROD")
    throw new Error("JIRA_PINNED_ENVIRONMENT_FORBIDDEN");
  const adapterFamily = requiredString(
    connection.adapterFamily,
    "JIRA_PINNED_ADAPTER_FAMILY_REQUIRED",
  );
  if (
    !new Set(["jira-cloud-v3", "jira-dc-9-v2", "jira-dc-10-v2", "jira-dc-11-v2"]).has(adapterFamily)
  ) {
    throw new Error("JIRA_PINNED_ADAPTER_FAMILY_FORBIDDEN");
  }
  if (
    adapterFamily !== primary.pin.adapterFamily ||
    adapterFamily !== resolved.adapterFamily ||
    requiredString(connection.adapterContractVersion, "JIRA_PINNED_ADAPTER_VERSION_REQUIRED") !==
      primary.pin.adapterContractVersion
  )
    throw new Error("JIRA_PINNED_ADAPTER_MISMATCH");

  const fieldIds = record(
    mapping.requestCreateFieldIds,
    "JIRA_PINNED_REQUEST_FIELD_MAPPING_REQUIRED",
  );
  const summary = exactFieldId(fieldIds.summary, "JIRA_PINNED_SUMMARY_FIELD_REQUIRED");
  const description =
    fieldIds.description === undefined
      ? undefined
      : exactFieldId(fieldIds.description, "JIRA_PINNED_DESCRIPTION_FIELD_INVALID");
  const projectDiscriminator = exactFieldId(
    fieldIds.projectDiscriminator,
    "JIRA_PINNED_PROJECT_DISCRIMINATOR_FIELD_REQUIRED",
  );
  const acceptanceOutcome =
    fieldIds.acceptanceOutcome === undefined
      ? undefined
      : exactFieldId(fieldIds.acceptanceOutcome, "JIRA_PINNED_ACCEPTANCE_OUTCOME_FIELD_INVALID");
  const outputFieldAllowlist = stringArray(
    mapping.outputFieldAllowlist,
    "JIRA_PINNED_OUTPUT_FIELD_ALLOWLIST_REQUIRED",
  );
  for (const fieldId of [summary, description, projectDiscriminator, acceptanceOutcome].filter(
    (value): value is string => value !== undefined,
  )) {
    if (!outputFieldAllowlist.includes(fieldId))
      throw new Error("JIRA_PINNED_REQUEST_FIELD_NOT_ALLOWLISTED");
  }
  const markerFieldId = exactFieldId(
    profile.effectMarkerFieldId,
    "JIRA_PINNED_EFFECT_MARKER_FIELD_REQUIRED",
  );

  return Object.freeze({
    endpoint,
    environment,
    adapterFamily: adapterFamily as QaJiraPinnedRequestCreateRuntime["adapterFamily"],
    projectId: exactIdFrom(profile.project, connection.projectId, "JIRA_PINNED_PROJECT_REQUIRED"),
    issueTypeId: exactIdFrom(
      profile.issueType,
      connection.issueTypeId,
      "JIRA_PINNED_ISSUE_TYPE_REQUIRED",
    ),
    markerFieldId,
    authorityFieldIds: Object.freeze([...new Set([...outputFieldAllowlist, markerFieldId])]),
    projectDiscriminator: requiredString(
      mapping.projectDiscriminator,
      "JIRA_PINNED_PROJECT_DISCRIMINATOR_REQUIRED",
    ),
    fieldIds: Object.freeze({
      summary,
      ...(description ? { description } : {}),
      projectDiscriminator,
      ...(acceptanceOutcome ? { acceptanceOutcome } : {}),
    }),
  });
}

function mappedRequestFields(
  runtime: QaJiraPinnedRequestCreateRuntime,
  input: OperationalRequestCreateInput,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    [runtime.fieldIds.summary]: input.summary,
    ...(runtime.fieldIds.description && input.description
      ? { [runtime.fieldIds.description]: input.description }
      : {}),
    [runtime.fieldIds.projectDiscriminator]: runtime.projectDiscriminator,
    ...(runtime.fieldIds.acceptanceOutcome && input.acceptanceOutcome
      ? { [runtime.fieldIds.acceptanceOutcome]: input.acceptanceOutcome }
      : {}),
  });
}

function observedAt(observation: RequestCreateObservation): string {
  const providerUpdatedAt = observation.providerUpdatedAt;
  return typeof providerUpdatedAt === "string" && !Number.isNaN(Date.parse(providerUpdatedAt))
    ? providerUpdatedAt
    : new Date().toISOString();
}

function resultFromObservation(
  context: ConnectorRuntimeContext,
  target: OperationalWorkItemTarget,
  observation: RequestCreateObservation,
): OperationalRequestCreateResult {
  if (!target.naturalKey) throw new Error("JIRA_REQUEST_NATURAL_KEY_REQUIRED");
  return Object.freeze({
    operation: "request.create",
    entityKind: "REQUEST",
    externalEntityId: observation.externalEntityId,
    externalDisplayKey: observation.externalDisplayKey,
    externalVersion: observation.externalRevisionToken,
    rawExternalState: "Open",
    normalizedStatus: "NEW",
    naturalKey: target.naturalKey,
    effectId: context.effectIdempotencyKey,
    observedAt: observedAt(observation),
  });
}

type PreCreateSourceValidation = Readonly<{
  fingerprint: string;
  validate: (() => Promise<void>) | undefined;
}>;

/**
 * Keeps the provider marker lookup ahead of mutable source validation while
 * still enforcing that validation immediately before a first create. A retry
 * that finds the central issue therefore reconciles its immutable sub-effect
 * plan without reinterpreting a newer source revision.
 */
class QaJiraPreCreateValidationPort implements RequestCreatePort {
  readonly #registrations = new Map<string, PreCreateSourceValidation>();

  constructor(private readonly delegate: RequestCreatePort) {}

  register(marker: string, registration: PreCreateSourceValidation): void {
    const current = this.#registrations.get(marker);
    if (current && current.fingerprint !== registration.fingerprint) {
      throw new Error("JIRA_SOURCE_PLAN_IDENTITY_CONFLICT");
    }
    this.#registrations.set(marker, registration);
  }

  async lookup(marker: string) {
    return await this.delegate.lookup(marker);
  }

  async create(input: Readonly<{ fields: Readonly<Record<string, unknown>>; marker: string }>) {
    const registration = this.#registrations.get(input.marker);
    if (!registration) throw new Error("JIRA_SOURCE_PRE_CREATE_PLAN_REQUIRED");
    await registration.validate?.();
    return await this.delegate.create(input);
  }

  async observe(externalEntityId: string): Promise<RequestCreateObservation> {
    return await this.delegate.observe(externalEntityId);
  }

  async applySubEffect(
    externalEntityId: string,
    effect: Parameters<NonNullable<RequestCreatePort["applySubEffect"]>>[1],
  ): Promise<string> {
    if (!this.delegate.applySubEffect) throw new Error("JIRA_SUB_EFFECT_PORT_REQUIRED");
    return await this.delegate.applySubEffect(externalEntityId, effect);
  }
}

function sourcePlanFingerprint(
  input: OperationalRequestCreateInput,
  plan: QaJiraSourceContextPlan,
): string {
  return JSON.stringify(
    Object.freeze({
      sourceRefs: input.sourceRefs ?? Object.freeze([]),
      subEffects: plan.subEffects,
    }),
  );
}

function optionalQaJiraSourceLinkPolicy(resolved: QaJiraResolvedPins) {
  // Seed v3's immutable Profile v5 predates sourceLinkPolicy. It remains a
  // valid recovery pin for commands without sourceRefs; source-bearing work
  // still calls the strict resolver and fails closed when policy is absent.
  if (resolved.profileContent.sourceLinkPolicy === undefined) return undefined;
  return resolveQaJiraSourceLinkPolicy(resolved);
}

/**
 * The local Jira composition intentionally speaks Jira HTTP to Mock Hub. It
 * never imports connector-mock and it never executes in the API process.
 */
export function createQaJiraLocalOperationalBrokerMap(
  environment: RuntimeEnvironment,
  transport: typeof fetch = fetch,
): QaUs1OperationalBrokerMap {
  if (!isQaJiraLocalComposition(environment.composition)) {
    throw new Error("QA_JIRA_OPERATIONAL_BROKER_COMPOSITION_REQUIRED");
  }
  if (environment.environmentScope !== "LOCAL" || !environment.mockHubUrl) {
    throw new Error("QA_JIRA_OPERATIONAL_BROKER_LOCAL_ENDPOINT_REQUIRED");
  }
  const port = createQaJiraLocalRequestCreatePort(environment, transport);
  const service = new JiraRequestCreateService(port);

  return Object.freeze({
    [qaUs1OperationalRoute]: Object.freeze({
      invoke: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        input: OperationalRequestCreateInput,
      ) => {
        assertOperationalTarget(target);
        assertSparseRequestCreate(input);
        const outcome = await service.execute({
          effectMarker: context.effectIdempotencyKey,
          fields: Object.freeze({
            summary: input.summary,
            ...(input.description ? { description: input.description } : {}),
            ...(input.acceptanceOutcome ? { customfield_10012: input.acceptanceOutcome } : {}),
            customfield_10010: target.projectId,
          }),
          subEffects: Object.freeze([]),
        });
        if (outcome.status !== "CONFIRMED") {
          throw new Error(`JIRA_REQUEST_CREATE_${outcome.reasonCode}`);
        }
        return resultFromObservation(context, target, outcome.observation);
      },
      readByEffect: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        effectIdempotencyKey: string,
      ) => {
        assertOperationalTarget(target);
        const lookup = await port.lookup(effectIdempotencyKey);
        if (lookup.state === "PROVEN_ABSENT") return undefined;
        if (lookup.state === "UNKNOWN") throw new Error("JIRA_REQUEST_EFFECT_VISIBILITY_UNKNOWN");
        if (lookup.state === "MULTIPLE") throw new Error("JIRA_REQUEST_EFFECT_MULTIPLE_MATCHES");
        if (lookup.state !== "FOUND")
          throw new Error("JIRA_REQUEST_EFFECT_LOOKUP_STATE_UNREACHABLE");
        return resultFromObservation(
          { ...context, effectIdempotencyKey },
          target,
          await port.observe(lookup.externalEntityId),
        );
      },
    }),
  });
}

/**
 * Per-command Jira broker. Every protocol/runtime choice comes from the exact
 * immutable chain resolved for this command; process environment values do not
 * select the Jira endpoint, project, issue type, marker or output fields.
 */
export function createQaJiraPinnedOperationalBrokerMap(
  resolved: QaJiraResolvedPins,
  transport: typeof fetch = fetch,
  durability: Readonly<{
    port?: RequestCreatePort;
    receipts?: RequestSubEffectStore;
  }> = {},
): QaUs1OperationalBrokerMap {
  const runtime = pinnedRequestCreateRuntime(resolved);
  const port = durability.port ?? createQaJiraPinnedRequestCreatePort(resolved, transport);
  const preCreatePort = new QaJiraPreCreateValidationPort(port);
  const service = new JiraRequestCreateService(preCreatePort, durability.receipts);

  return Object.freeze({
    [qaUs1OperationalRoute]: Object.freeze({
      invoke: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        input: OperationalRequestCreateInput,
      ) => {
        assertOperationalTarget(target);
        assertSparseRequestCreate(input);
        if (
          context.scope.workspaceId !== target.workspaceId ||
          context.scope.projectId !== target.projectId ||
          context.profileRef.id !== resolved.profileRef.id ||
          context.profileRef.version !== resolved.profileRef.version
        )
          throw new Error("JIRA_REQUEST_CREATE_RUNTIME_SCOPE_MISMATCH");
        const sourcePlan = prepareQaJiraRequestSourceContext({
          resolved,
          request: input,
          effectMarker: context.effectIdempotencyKey,
        });
        const fingerprint = sourcePlanFingerprint(input, sourcePlan);
        let activeValidation: Promise<void> | undefined;
        preCreatePort.register(
          context.effectIdempotencyKey,
          Object.freeze({
            fingerprint,
            validate:
              sourcePlan.subEffects.length === 0
                ? undefined
                : async () => {
                    if (!activeValidation) {
                      activeValidation = planQaJiraRequestSourceContext({
                        resolved,
                        request: input,
                        effectMarker: context.effectIdempotencyKey,
                        signal: context.signal,
                        transport,
                      }).then((validated) => {
                        if (sourcePlanFingerprint(input, validated) !== fingerprint) {
                          throw new Error("JIRA_SOURCE_PLAN_VALIDATION_CONFLICT");
                        }
                      });
                    }
                    try {
                      await activeValidation;
                    } finally {
                      activeValidation = undefined;
                    }
                  },
          }),
        );
        const outcome = await service.execute({
          effectMarker: context.effectIdempotencyKey,
          fields: mappedRequestFields(runtime, input),
          subEffects: sourcePlan.subEffects,
        });
        if (outcome.status !== "CONFIRMED")
          throw new Error(`JIRA_REQUEST_CREATE_${outcome.reasonCode}`);
        return resultFromObservation(context, target, outcome.observation);
      },
      readByEffect: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        effectIdempotencyKey: string,
      ) => {
        assertOperationalTarget(target);
        const lookup = await port.lookup(effectIdempotencyKey);
        if (lookup.state === "PROVEN_ABSENT") return undefined;
        if (lookup.state === "UNKNOWN") throw new Error("JIRA_REQUEST_EFFECT_VISIBILITY_UNKNOWN");
        if (lookup.state === "MULTIPLE") throw new Error("JIRA_REQUEST_EFFECT_MULTIPLE_MATCHES");
        if (lookup.state !== "FOUND")
          throw new Error("JIRA_REQUEST_EFFECT_LOOKUP_STATE_UNREACHABLE");
        return resultFromObservation(
          { ...context, effectIdempotencyKey },
          target,
          await port.observe(lookup.externalEntityId),
        );
      },
    }),
  });
}

export function createQaJiraPinnedRequestCreatePort(
  resolved: QaJiraResolvedPins,
  transport: typeof fetch = fetch,
): JiraHttpRequestCreatePort {
  const runtime = pinnedRequestCreateRuntime(resolved);
  const sourceLink = optionalQaJiraSourceLinkPolicy(resolved);
  const baseUrl = new URL(runtime.endpoint);
  const client = new JiraRestClient({
    baseUrl: baseUrl.href,
    environment: runtime.environment,
    allowedOrigins: [baseUrl.origin],
    ...(runtime.environment === "LOCAL" ? { allowedLocalHostnames: [baseUrl.hostname] } : {}),
    transport,
  });
  return new JiraHttpRequestCreatePort({
    client,
    dialect: createJiraDialect(runtime.adapterFamily),
    projectId: runtime.projectId,
    issueTypeId: runtime.issueTypeId,
    markerFieldId: runtime.markerFieldId,
    authorityFieldIds: runtime.authorityFieldIds,
    ...(sourceLink
      ? { issueLinkTypeId: sourceLink.typeId, issueLinkDirection: sourceLink.direction }
      : {}),
  });
}

export function createQaJiraLocalRequestCreatePort(
  environment: RuntimeEnvironment,
  transport: typeof fetch = fetch,
): JiraHttpRequestCreatePort {
  if (!isQaJiraLocalComposition(environment.composition)) {
    throw new Error("QA_JIRA_OPERATIONAL_BROKER_COMPOSITION_REQUIRED");
  }
  if (environment.environmentScope !== "LOCAL" || !environment.mockHubUrl) {
    throw new Error("QA_JIRA_OPERATIONAL_BROKER_LOCAL_ENDPOINT_REQUIRED");
  }
  const baseUrl = new URL(environment.mockHubUrl);
  const dialect = createJiraDialect("jira-cloud-v3");
  const client = new JiraRestClient({
    baseUrl: baseUrl.href,
    environment: "LOCAL",
    allowedOrigins: [baseUrl.origin],
    allowedLocalHostnames: [baseUrl.hostname],
    transport,
  });
  return new JiraHttpRequestCreatePort({
    client,
    dialect,
    projectId: "100",
    issueTypeId: "10001",
    markerFieldId: "customfield_10011",
    authorityFieldIds: ["summary", "description", "customfield_10010", "customfield_10011"],
    remoteLinkStrategy: { kind: "ISSUE_PROPERTY", propertyKeyPrefix: "awp.remote-link" },
  });
}
