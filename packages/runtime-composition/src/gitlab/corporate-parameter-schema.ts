import type { DataSource, EntityManager } from "typeorm";

import {
  designContractRegistry,
  type JsonValue,
  type OfflineSchemaRegistry,
  sha256,
} from "@awp/platform-contracts";

type Exact = Readonly<{ id: string; version: number; contentHash: string }>;
type Suite = Readonly<{
  suiteKey: string;
  suiteBindingRef: Readonly<{ id: string; version: number }>;
  suiteBindingHash: string;
  parameterSchemaRef: Exact;
  acceptedParameters: Readonly<Record<string, unknown>>;
  parametersHash: string;
}>;

// External references would not be covered by the published schema's hash.
function hasExternalReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExternalReference);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    ["$ref", "$dynamicRef", "$recursiveRef"].includes(key)
      ? typeof child !== "string" || !child.startsWith("#")
      : hasExternalReference(child),
  );
}

/** Only explicitly named, closed parameter schemas shipped in the trusted image are accepted. */
export function validateCorporateSuiteParameters(
  ref: Exact,
  parameters: Readonly<Record<string, unknown>>,
  registry: OfflineSchemaRegistry = designContractRegistry,
): void {
  if (
    !ref ||
    !Number.isSafeInteger(ref.version) ||
    ref.version < 1 ||
    !/^urn:awp:schemas:qa:automation-parameters:[a-z0-9][a-z0-9-]*:v[1-9][0-9]*$/u.test(ref.id) ||
    !ref.id.endsWith(`:v${ref.version}`) ||
    !/^sha256:[a-f0-9]{64}$/u.test(ref.contentHash)
  )
    throw new Error("CORPORATE_GITLAB_PARAMETER_SCHEMA_INVALID");
  let document;
  try {
    document = registry.document(ref.id);
  } catch {
    throw new Error("CORPORATE_GITLAB_PARAMETER_SCHEMA_UNAVAILABLE");
  }
  if (
    document.digest !== ref.contentHash ||
    sha256(document.schema as JsonValue) !== ref.contentHash ||
    document.schema.$id !== ref.id ||
    document.schema.type !== "object" ||
    document.schema.additionalProperties !== false ||
    hasExternalReference(document.schema)
  )
    throw new Error("CORPORATE_GITLAB_PARAMETER_SCHEMA_MISMATCH");
  try {
    registry.validateById(ref.id, parameters);
  } catch {
    throw new Error("CORPORATE_GITLAB_PARAMETERS_INVALID");
  }
}

/** Resolve the trusted schema pin from the current published Suite, not from the request. */
export async function assertCorporatePublishedSuiteParameters(
  source: DataSource | EntityManager,
  scope: Readonly<{ workspaceId: string; projectId: string }>,
  suite: Suite,
  registry: OfflineSchemaRegistry = designContractRegistry,
): Promise<void> {
  if (
    !suite?.suiteBindingRef ||
    !suite.parameterSchemaRef ||
    !suite.acceptedParameters ||
    typeof suite.acceptedParameters !== "object" ||
    Array.isArray(suite.acceptedParameters)
  )
    throw new Error("CORPORATE_GITLAB_SUITE_CONFIGURATION_INVALID");
  const rows = (await source.query(
    `SELECT v.content,v.content_hash FROM qa_automation_suite_bindings h
     JOIN qa_automation_suite_binding_versions v ON v.suite_binding_version_id=h.current_published_version_id
       AND v.workspace_id=h.workspace_id AND v.project_id=h.project_id AND v.suite_binding_id=h.suite_binding_id
     WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.suite_binding_id=$3 AND v.version=$4 AND h.suite_key=$5 AND v.state='PUBLISHED'
     FOR SHARE OF h,v`,
    [
      scope.workspaceId,
      scope.projectId,
      suite.suiteBindingRef.id,
      suite.suiteBindingRef.version,
      suite.suiteKey,
    ],
  )) as readonly { content: unknown; content_hash: string }[];
  const content =
    typeof rows[0]?.content === "string"
      ? (JSON.parse(rows[0].content) as unknown)
      : rows[0]?.content;
  const schemaRef =
    content && typeof content === "object" && !Array.isArray(content)
      ? (content as Record<string, unknown>).parameterSchemaRef
      : undefined;
  if (
    rows.length !== 1 ||
    !content ||
    typeof content !== "object" ||
    Array.isArray(content) ||
    rows[0]!.content_hash !== suite.suiteBindingHash ||
    sha256(content as JsonValue) !== suite.suiteBindingHash ||
    !schemaRef ||
    typeof schemaRef !== "object" ||
    Array.isArray(schemaRef) ||
    sha256(schemaRef as JsonValue) !== sha256(suite.parameterSchemaRef as unknown as JsonValue) ||
    sha256(suite.acceptedParameters as JsonValue) !== suite.parametersHash
  )
    throw new Error("CORPORATE_GITLAB_SUITE_CONFIGURATION_STALE");
  validateCorporateSuiteParameters(suite.parameterSchemaRef, suite.acceptedParameters, registry);
}
