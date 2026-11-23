import {
  createJiraDialect,
  JiraRequestCreateService,
  JiraRestClient,
  type JiraTransport,
  type RequestCreatePort,
} from "@awp/connector-jira";
import type { JiraAdapterFamily, JiraPilotMetadataPackage } from "@awp/platform-contracts";

import {
  assertJiraEffectsAllowed,
  isQaJiraLocalComposition,
  type RuntimeEnvironment,
} from "../config/environment.ts";

export interface JiraRuntimeComposition {
  readonly family: JiraAdapterFamily;
  readonly dialect: ReturnType<typeof createJiraDialect>;
  readonly client: JiraRestClient;
  readonly authorityNamespace: string;
  readonly effectCapable: true;
}

export function createJiraRuntimeComposition(
  environment: RuntimeEnvironment,
  metadata: JiraPilotMetadataPackage,
  transport: JiraTransport,
): JiraRuntimeComposition {
  assertJiraEffectsAllowed(environment);
  if (metadata.environment !== environment.environmentScope)
    throw new Error("JIRA_METADATA_ENVIRONMENT_MISMATCH");
  if (
    isQaJiraLocalComposition(environment.composition) &&
    new URL(metadata.endpoint.baseUrl).origin !== new URL(environment.mockHubUrl!).origin
  )
    throw new Error("JIRA_LOCAL_MOCK_HUB_ENDPOINT_REQUIRED");
  const dialect = createJiraDialect(metadata.adapter.family);
  if (metadata.adapter.exactBuild.length === 0 || metadata.adapter.contractVersion !== "1.0.0")
    throw new Error("JIRA_ADAPTER_PIN_INVALID");
  const origin = new URL(metadata.endpoint.baseUrl).origin;
  return Object.freeze({
    family: metadata.adapter.family,
    dialect,
    client: new JiraRestClient({
      baseUrl: metadata.endpoint.baseUrl,
      environment: metadata.environment,
      allowedOrigins: [origin],
      transport,
    }),
    authorityNamespace: `${metadata.endpoint.tenantKey}:${metadata.adapter.family}`,
    effectCapable: true,
  });
}

export interface JiraOperationRegistration {
  readonly operation: string;
  readonly primaryRole: string;
  readonly auxiliaryRoles: readonly string[];
}
export const jiraOperationRegistrations: readonly JiraOperationRegistration[] = Object.freeze([
  Object.freeze({
    operation: "request.create",
    primaryRole: "QA_REQUEST_AUTHORITY",
    auxiliaryRoles: Object.freeze(["SOURCE_CONTEXT"]),
  }),
  Object.freeze({
    operation: "request.transition",
    primaryRole: "QA_REQUEST_AUTHORITY",
    auxiliaryRoles: Object.freeze([]),
  }),
  Object.freeze({
    operation: "request.assign",
    primaryRole: "QA_REQUEST_AUTHORITY",
    auxiliaryRoles: Object.freeze([]),
  }),
  Object.freeze({
    operation: "request.set-priority",
    primaryRole: "QA_REQUEST_AUTHORITY",
    auxiliaryRoles: Object.freeze([]),
  }),
  Object.freeze({
    operation: "request.set-due-date",
    primaryRole: "QA_REQUEST_AUTHORITY",
    auxiliaryRoles: Object.freeze([]),
  }),
  Object.freeze({
    operation: "defect.create",
    primaryRole: "DEFECT_DESTINATION",
    auxiliaryRoles: Object.freeze(["QA_REQUEST_AUTHORITY"]),
  }),
]);

export function composeJiraRequestCreateHandler(port: RequestCreatePort): JiraRequestCreateService {
  return new JiraRequestCreateService(port);
}
export function resolveDefectAuthorityChain<
  T extends Readonly<{ sequence: number; purpose: string; logicalRole: string }>,
>(pins: readonly T[]): readonly T[] {
  const ordered = [...pins].sort((a, b) => a.sequence - b.sequence);
  if (
    ordered[0]?.purpose !== "PRIMARY" ||
    ordered[0]?.logicalRole !== "DEFECT_DESTINATION" ||
    ordered[1]?.purpose !== "AUXILIARY" ||
    ordered[1]?.logicalRole !== "QA_REQUEST_AUTHORITY"
  )
    throw new Error("DEFECT_AUTHORITY_CHAIN_INVALID");
  return Object.freeze(ordered);
}
