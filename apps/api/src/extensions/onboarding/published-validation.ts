import {
  type GeneratedSchemaDocument,
  type JsonValue,
  OfflineSchemaRegistry,
  sha256,
} from "@awp/platform-contracts";

import openapi from "../../../openapi.generated.json" with { type: "json" };
import { reject } from "./durable-http.ts";

type Document = Record<string, unknown>;
const doc = (value: unknown) => value as Document;
const id = "urn:awp:runtime:onboarding-http:1.1";
const operationNames: Record<string, string> = {
  catalog: "listAuthorizedProjects",
  register: "registerProject",
  onboarding: "getProjectOnboarding",
  evaluate: "evaluateProjectOnboarding",
  activatePilot: "activateProjectPilot",
  grantEntitlement: "grantProjectEntitlement",
  replaceEntitlement: "replaceProjectEntitlement",
  revokeEntitlement: "revokeProjectEntitlement",
  validateBinding: "validateBinding",
  acceptBinding: "acceptBindingFunctionally",
  applyBindingLifecycleAction: "applyBindingLifecycleAction",
  suspend: "emergencySuspendProject",
  resume: "resumeProject",
  publishQaEnvironment: "publishProjectEnvironment",
  publishQaContext: "publishQaProjectContext",
  publishQaResource: "publishQaProjectResource",
  acquireAccountLease: "acquireTestAccountLease",
  releaseAccountLease: "releaseTestAccountLease",
};
function rewrite(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewrite);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => k !== "$id" && k !== "$schema")
      .map(([key, child]) => [
        key,
        key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")
          ? `${id}#/$defs/${child.slice("#/components/schemas/".length)}`
          : rewrite(child),
      ]),
  );
}
function resolve(value: unknown): Document {
  const d = doc(value);
  if (typeof d.$ref === "string" && d.$ref.startsWith("#/"))
    return d.$ref
      .slice(2)
      .split("/")
      .reduce<unknown>((v, key) => doc(v)[key], openapi) as Document;
  return d;
}
const operations = new Map<string, Document>();
for (const route of Object.values(openapi.paths))
  for (const method of ["get", "post"]) {
    const operation = doc(route)[method];
    if (operation && Object.values(operationNames).includes(String(doc(operation).operationId)))
      operations.set(String(doc(operation).operationId), doc(operation));
  }
const definitions = doc(rewrite(openapi.components.schemas));
for (const [name, operation] of operations) {
  if (operation.requestBody)
    definitions[`${name}_request`] = rewrite(
      doc(doc(resolve(operation.requestBody).content)["application/json"]).schema,
    );
  for (const [status, response] of Object.entries(doc(operation.responses))) {
    const content = doc(resolve(response).content);
    if (content?.["application/json"])
      definitions[`${name}_response_${status}`] = rewrite(doc(content["application/json"]).schema);
  }
}
const schema = { $id: id, $defs: definitions };
const document: GeneratedSchemaDocument = {
  id,
  contributionKey: "007-published-http",
  contributionOrder: 700,
  sourcePath: "apps/api/openapi.generated.json",
  digest: sha256(schema as JsonValue),
  schema,
};
let registry: OfflineSchemaRegistry | undefined;
function validate(key: string, value: unknown) {
  (registry ??= new OfflineSchemaRegistry([document])).validateById(`${id}#/$defs/${key}`, value);
}
export function validatePublishedRequest(handler: string, body: unknown): void {
  const name = operationNames[handler];
  if (!name || !operations.get(name)?.requestBody) return;
  try {
    validate(`${name}_request`, body);
  } catch {
    return reject("HTTP_COMMAND_SCHEMA_INVALID", 400);
  }
}
export function validatePublishedResponse(handler: string, status: number, value: unknown): void {
  const name = operationNames[handler];
  if (!name) return;
  try {
    validate(`${name}_response_${status}`, value);
  } catch {
    return reject("HTTP_PROJECTION_UNAVAILABLE", 503);
  }
}
