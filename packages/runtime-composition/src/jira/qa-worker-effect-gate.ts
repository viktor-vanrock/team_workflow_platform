import type { DataSource } from "typeorm";

import { assertRequestCreateAuthority } from "@awp/connector-jira";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type AuthorizationBasisRef,
  type CommandConfigurationPin,
  type ConnectorCommand,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  evaluateEffectGate,
  type ProjectEffectGuardPort,
  validateAuthorizationBasis,
} from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";

import { TypeOrmProjectEffectGuard } from "../onboarding/project-effect-guard.ts";
import type { QaJiraResolvedPins } from "./qa-command-materializer.ts";

type Row = Readonly<Record<string, unknown>>;

export interface QaJiraRequestCreateEffectGateDecision {
  readonly evaluatedAt: Date;
  readonly authorizationBasis: AuthorizationBasisRef;
  readonly authorizationBasisHash: `sha256:${string}`;
  readonly configurationHash: `sha256:${string}`;
}

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function ref(value: unknown, code: string): Readonly<{ id: string; version: number }> {
  const parsed = json<Row>(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.id !== "string" ||
    !Number.isSafeInteger(Number(parsed.version)) ||
    Number(parsed.version) < 1
  ) {
    throw new Error(code);
  }
  return Object.freeze({ id: parsed.id, version: Number(parsed.version) });
}

function persistedPin(row: Row): CommandConfigurationPin {
  const sequence = Number(row.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    throw new Error("JIRA_EFFECT_PIN_SEQUENCE_INVALID");
  const purpose = String(row.purpose);
  if (purpose !== "PRIMARY" && purpose !== "AUXILIARY")
    throw new Error("JIRA_EFFECT_PIN_PURPOSE_INVALID");
  return Object.freeze({
    sequence,
    purpose,
    logicalRole: String(row.logical_role),
    bindingRef: ref(row.project_integration_binding_ref, "JIRA_EFFECT_BINDING_PIN_INVALID"),
    profileRef: ref(row.connector_profile_ref, "JIRA_EFFECT_PROFILE_PIN_INVALID"),
    mappingRef: ref(row.mapping_ref, "JIRA_EFFECT_MAPPING_PIN_INVALID"),
    connectionRef: ref(row.connection_ref, "JIRA_EFFECT_CONNECTION_PIN_INVALID"),
    contentHash: String(row.content_hash) as `sha256:${string}`,
    adapterFamily: String(row.adapter_family),
    adapterContractVersion: String(row.adapter_contract_version),
    authorityNamespaceHash: String(row.authority_namespace_hash),
  });
}

function exactPin(left: CommandConfigurationPin, right: CommandConfigurationPin): boolean {
  return (
    left.sequence === right.sequence &&
    left.purpose === right.purpose &&
    left.logicalRole === right.logicalRole &&
    left.bindingRef.id === right.bindingRef.id &&
    left.bindingRef.version === right.bindingRef.version &&
    left.profileRef.id === right.profileRef.id &&
    left.profileRef.version === right.profileRef.version &&
    left.mappingRef.id === right.mappingRef.id &&
    left.mappingRef.version === right.mappingRef.version &&
    left.connectionRef.id === right.connectionRef.id &&
    left.connectionRef.version === right.connectionRef.version &&
    left.contentHash === right.contentHash &&
    left.adapterFamily === right.adapterFamily &&
    left.adapterContractVersion === right.adapterContractVersion &&
    left.authorityNamespaceHash === right.authorityNamespaceHash
  );
}

async function persistedConfigurationHash(
  source: DataSource,
  command: ConnectorCommand,
  resolved: QaJiraResolvedPins,
): Promise<`sha256:${string}`> {
  const rows = (await source.query(
    "SELECT sequence,purpose,logical_role,project_integration_binding_ref,connector_profile_ref,mapping_ref,connection_ref,content_hash,adapter_family,adapter_contract_version,authority_namespace_hash FROM connector_command_configuration_pins WHERE command_id=$1 ORDER BY sequence",
    [command.id],
  )) as readonly Row[];
  const persisted = rows.map(persistedPin);
  const expected = resolved.pinSet.entries;
  if (
    persisted.length !== expected.length ||
    persisted.some((pin, index) => !exactPin(pin, expected[index]!))
  ) {
    throw new Error("JIRA_EFFECT_PIN_SET_DRIFT");
  }
  return sha256(persisted as unknown as JsonValue);
}

/**
 * Reloads live access policy and exact durable command pins immediately before
 * dispatch. A denial completes before a Jira broker/transport is constructed.
 */
export async function revalidateQaJiraRequestCreateEffect(
  source: DataSource,
  command: ConnectorCommand,
  resolved: QaJiraResolvedPins,
  evaluatedAt = new Date(),
  effectGuard: ProjectEffectGuardPort = new TypeOrmProjectEffectGuard(source),
): Promise<QaJiraRequestCreateEffectGateDecision> {
  if (!Number.isFinite(evaluatedAt.getTime())) throw new Error("JIRA_EFFECT_GATE_TIME_INVALID");
  if (
    command.actor.kind !== "HUMAN" ||
    command.capability.key !== "operational-work-item" ||
    command.capability.exactContractVersion !== "1.0.0" ||
    command.capability.operation !== "request.create" ||
    command.capability.logicalRole !== "QA_REQUEST_AUTHORITY"
  )
    throw new Error("JIRA_REQUEST_CREATE_COMMAND_INVALID");
  if (!command.target || typeof command.target !== "object" || Array.isArray(command.target))
    throw new Error("JIRA_REQUEST_CREATE_TARGET_INVALID");
  const target = command.target as Row;
  const targetWorkspaceId = String(target.workspaceId ?? "");
  const targetProjectId = String(target.projectId ?? "");

  const scope = {
    kind: "PROJECT" as const,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
  };
  await effectGuard.assertEffectsAllowed(scope);
  const access = new TypeOrmScopedAccessRepository(source);
  const project = await access.getProject(scope);
  if (
    !project ||
    project.state !== "ACTIVE" ||
    project.classification.key !== command.dataClassificationKey
  ) {
    throw new Error("REQUEST_CREATE_PROJECT_SCOPE_MISMATCH");
  }
  const context = Object.freeze({
    actor: command.actor,
    scope,
    correlationId: command.correlationId,
    causationId: command.causationId,
  });
  const facts = await access.authorizationFacts(scope, command.actor.principalId, evaluatedAt);
  const policy = new DenyByDefaultAuthorizationPolicy(defaultClassificationCatalog);
  const authorization = policy.decide({
    context,
    permission: "qa.request.confirm",
    resourceClassification: defaultClassificationCatalog.reference(command.dataClassificationKey),
    facts,
    policyVersion: "qa-jira-request-create@1",
    at: evaluatedAt,
  });
  assertRequestCreateAuthority({
    authorized: authorization.allowed,
    projectId: command.projectId,
    targetProjectId,
    profileStatus: "VALID",
    expectedAuthorityNamespace: resolved.pinSet.entries[0]?.authorityNamespaceHash ?? "",
    actualAuthorityNamespace: resolved.entries[0]?.pin.authorityNamespaceHash ?? "",
  });
  if (targetWorkspaceId !== command.workspaceId)
    throw new Error("REQUEST_CREATE_PROJECT_SCOPE_MISMATCH");
  if (!authorization.basis) throw new Error("REQUEST_CREATE_AUTHORIZATION_BASIS_REQUIRED");
  validateAuthorizationBasis(scope, authorization.basis);

  const pinnedConfigurationHash = await persistedConfigurationHash(source, command, resolved);
  const liveConfigurationHash = sha256(resolved.pinSet.entries as unknown as JsonValue);
  const gate = await evaluateEffectGate({
    approvalMode: "NOT_REQUIRED",
    pinnedConfigurationHash,
    liveConfigurationHash,
    policyAllowed: authorization.allowed,
    authorizationBasis: authorization.basis,
    invoke: async () => undefined,
  });
  if (gate.status !== "ALLOWED") {
    throw new Error(
      gate.reasonCode === "CONFIGURATION_DRIFT"
        ? "JIRA_EFFECT_PIN_SET_DRIFT"
        : "REQUEST_CREATE_UNAUTHORIZED",
    );
  }
  return Object.freeze({
    evaluatedAt: new Date(evaluatedAt.getTime()),
    authorizationBasis: authorization.basis,
    authorizationBasisHash: sha256(authorization.basis as unknown as JsonValue),
    configurationHash: liveConfigurationHash,
  });
}
