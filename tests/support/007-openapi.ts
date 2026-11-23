import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import { parse } from "yaml";

import { schemaDocuments } from "../../packages/platform-contracts/src/index.ts";

type Document = Record<string, unknown>;
const asDoc = (v: unknown) => v as Document;
const file = resolve(
  import.meta.dirname,
  "../../specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-api.v1.1.yaml",
);
const spec = parse(readFileSync(file, "utf8")) as {
  paths: Record<string, Document>;
  components: Record<string, Document>;
};
const id = "urn:awp:tests:onboarding-openapi:1.1";
const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
ajv.addFormat("uuid", /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu);
ajv.addFormat(
  "date-time",
  (value) =>
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) &&
    Number.isFinite(Date.parse(value)),
);
ajv.addFormat("uri-reference", (value) => {
  try {
    new URL(value, "https://contract.invalid");
    return !/\s/u.test(value);
  } catch {
    return false;
  }
});
for (const document of schemaDocuments) ajv.addSchema(document.schema, document.id);
function rewrite(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewrite);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key !== "$ref" || typeof child !== "string") return [key, rewrite(child)];
      if (child.startsWith("#/components/schemas/"))
        return [key, `${id}#/$defs/${child.slice("#/components/schemas/".length)}`];
      if (child.startsWith("..")) {
        const [path, fragment] = child.split("#");
        const target = JSON.parse(readFileSync(resolve(dirname(file), path!), "utf8")) as {
          $id: string;
        };
        return [key, `${target.$id}${fragment ? `#${fragment}` : ""}`];
      }
      return [key, child];
    }),
  );
}
ajv.addSchema({ $id: id, $defs: rewrite(spec.components.schemas) });
function resolveRef(value: unknown): Document {
  const d = asDoc(value);
  return typeof d.$ref === "string" && d.$ref.startsWith("#/components/")
    ? (d.$ref
        .slice(2)
        .split("/")
        .reduce<unknown>((v, k) => asDoc(v)[k], spec) as Document)
    : d;
}
const operations = new Map<string, Document>();
for (const route of Object.values(spec.paths))
  for (const method of ["get", "post"]) {
    const operation = route[method] as Document | undefined;
    if (operation) operations.set(String(operation.operationId), operation);
  }
function check(schema: unknown, value: unknown) {
  const validate = ajv.compile(rewrite(schema) as Document);
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}
export const publishedOperationIds = [...operations.keys()].sort();
export function assertPublishedRequest(operationId: string, body: unknown) {
  const operation = operations.get(operationId)!;
  const request = resolveRef(operation.requestBody);
  check(asDoc(asDoc(request.content)["application/json"]).schema, body);
}
export function assertPublishedResponse(
  operationId: string,
  response: { status: number; headers: Record<string, string>; body: Record<string, unknown> },
) {
  const operation = operations.get(operationId);
  expect(operation, operationId).toBeDefined();
  const responses = asDoc(operation!.responses),
    definition = resolveRef(responses[String(response.status)] ?? responses.default);
  expect(definition, `${operationId}: undocumented status ${response.status}`).toBeDefined();
  const content = asDoc(definition.content),
    media = Object.keys(content)[0]!;
  expect(response.headers["content-type"]).toContain(media);
  check(asDoc(content[media]).schema, response.body);
  for (const [name, header] of Object.entries(asDoc(definition.headers ?? {}))) {
    expect(response.headers[name.toLowerCase()], name).toBeDefined();
    check(resolveRef(header).schema, response.headers[name.toLowerCase()]);
  }
  expect(response.headers["cache-control"]).toBe("private, no-store");
}
