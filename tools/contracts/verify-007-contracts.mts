import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import { stringifyPortableJson } from "../verification/portable-json.mts";

type JsonRecord = Record<string, unknown>;

interface ContractDocument {
  readonly path: string;
  readonly value: unknown;
}

export interface Feature007ContractVerificationResult {
  readonly status: "PASS" | "FAIL";
  readonly schemas: number;
  readonly examples: number;
  readonly positiveExamples: number;
  readonly negativeExamples: number;
  readonly references: number;
  readonly schemaDigests: Readonly<Record<string, string>>;
  readonly openapiOperations: number;
  readonly publishedOpenapiOperations: number;
  readonly asyncapiChannels: number;
  readonly asyncapiOperations: number;
  readonly errors: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const contractRoot = "specs/007-project-onboarding-evidence-security/contracts";
const reportPath = "reports/007-project-onboarding-evidence-security/contracts.json";
const expectedOpenapiOperations = Object.freeze([
  "listAuthorizedProjects",
  "registerProject",
  "getProjectOnboarding",
  "evaluateProjectOnboarding",
  "activateProjectPilot",
  "grantProjectEntitlement",
  "revokeProjectEntitlement",
  "validateBinding",
  "acceptBindingFunctionally",
  "applyBindingLifecycleAction",
  "emergencySuspendProject",
  "resumeProject",
  "publishProjectEnvironment",
  "publishQaProjectContext",
  "publishQaProjectResource",
  "acquireTestAccountLease",
  "releaseTestAccountLease",
  "verifyEvidenceManifest",
  "getEvidencePackage",
  "exportEvidencePackage",
]);
const expectedAsyncapiOperations = Object.freeze([
  "publishProjectEvents",
  "consumeProjectEvents",
  "publishQaEvidenceEvents",
  "consumeQaEvidenceEvents",
  "publishArtifactEvents",
]);

function files(root: string, extensions: ReadonlySet<string>): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name);
      return entry.isDirectory()
        ? files(path, extensions)
        : extensions.has(extname(path))
          ? [path]
          : [];
    })
    .sort();
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function parseJsonWithDuplicateDetection(path: string): unknown {
  const bytes = readFileSync(path, "utf8");
  const duplicateCheck = parseDocument(bytes, { strict: true, uniqueKeys: true });
  if (duplicateCheck.errors.length > 0)
    throw new Error(duplicateCheck.errors.map(({ message }) => message).join("; "));
  return JSON.parse(bytes) as unknown;
}

function parseYaml(path: string): unknown {
  const document = parseDocument(readFileSync(path, "utf8"), { strict: true, uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error(document.errors.map(({ message }) => message).join("; "));
  return document.toJS() as unknown;
}

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as JsonRecord).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child),
  );
}

function rewriteSchemaRefs(
  value: unknown,
  sourcePath: string,
  idByPath: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value))
    return value.map((child) => rewriteSchemaRefs(child, sourcePath, idByPath));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, child]) => {
      if (
        key !== "$ref" ||
        typeof child !== "string" ||
        child.startsWith("#") ||
        child.startsWith("urn:")
      ) {
        return [key, rewriteSchemaRefs(child, sourcePath, idByPath)];
      }
      const [pathPart, fragment = ""] = child.split("#", 2);
      const id = idByPath.get(resolve(dirname(sourcePath), pathPart!));
      return [key, id ? `${id}${fragment ? `#${fragment}` : ""}` : child];
    }),
  );
}

function resolvePointer(value: unknown, fragment: string): void {
  if (fragment.length === 0) return;
  const decoded = decodeURIComponent(fragment);
  if (!decoded.startsWith("/"))
    throw new Error(`unsupported non-JSON-pointer fragment #${fragment}`);
  let current = value;
  for (const encoded of decoded.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current))
      throw new Error(`unresolved JSON pointer #${fragment}`);
    current = (current as JsonRecord)[key];
  }
}

export function canonicalize007Contract(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS cannot encode a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize007Contract).join(",")}]`;
  if (typeof value === "object") {
    const object = value as JsonRecord;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize007Contract(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`JCS cannot encode ${typeof value}`);
}

function sha256(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function addFormats(ajv: Ajv2020): void {
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
      Number.isFinite(Date.parse(value)),
  });
  ajv.addFormat("uuid", {
    type: "string",
    validate: (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value),
  });
}

function operationIds(
  document: JsonRecord | undefined,
  errors: string[],
  expected: readonly string[] = expectedOpenapiOperations,
): string[] {
  if (!document || document.openapi !== "3.1.0") {
    errors.push("Feature 007 OpenAPI 3.1 document is missing or incompatible");
    return [];
  }
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  const ids: string[] = [];
  for (const [path, rawItem] of Object.entries(record(document.paths))) {
    if (!path.startsWith("/v1/workspaces/{workspaceId}/projects"))
      errors.push(`OpenAPI path is not Workspace/Project scoped: ${path}`);
    for (const [method, operation] of Object.entries(record(rawItem))) {
      if (!methods.has(method)) continue;
      const id = record(operation).operationId;
      if (typeof id !== "string" || id.length === 0)
        errors.push(`OpenAPI ${method.toUpperCase()} ${path} has no operationId`);
      else ids.push(id);
    }
  }
  if (new Set(ids).size !== ids.length)
    errors.push("Feature 007 OpenAPI operationIds are not unique");
  if (JSON.stringify([...ids].sort()) !== JSON.stringify([...expected].sort())) {
    errors.push(`Feature 007 OpenAPI operation set is not closed: ${ids.join(",")}`);
  }
  return ids;
}

function validateAsyncapi(
  document: JsonRecord | undefined,
  errors: string[],
): { channels: number; operations: number } {
  if (!document || document.asyncapi !== "3.0.0") {
    errors.push("Feature 007 AsyncAPI 3.0 document is missing or incompatible");
    return { channels: 0, operations: 0 };
  }
  const channels = Object.keys(record(document.channels));
  const operations = Object.keys(record(document.operations));
  if (
    JSON.stringify(channels.sort()) !==
    JSON.stringify(["artifactEvents", "projectEvents", "qaEvidenceEvents"])
  ) {
    errors.push(`Feature 007 AsyncAPI channel set is not closed: ${channels.join(",")}`);
  }
  if (
    JSON.stringify(operations.sort()) !== JSON.stringify([...expectedAsyncapiOperations].sort())
  ) {
    errors.push(`Feature 007 AsyncAPI operation set is not closed: ${operations.join(",")}`);
  }
  return { channels: channels.length, operations: operations.length };
}

export function verify007Contracts(root = workspace): Feature007ContractVerificationResult {
  const base = resolve(root, contractRoot);
  const errors: string[] = [];
  if (!existsSync(base)) {
    return Object.freeze({
      status: "FAIL",
      schemas: 0,
      examples: 0,
      positiveExamples: 0,
      negativeExamples: 0,
      references: 0,
      schemaDigests: {},
      openapiOperations: 0,
      publishedOpenapiOperations: 0,
      asyncapiChannels: 0,
      asyncapiOperations: 0,
      errors: Object.freeze([`${contractRoot} is missing`]),
    });
  }

  const schemaPaths = files(resolve(base, "schemas"), new Set([".json"]));
  const examplePaths = files(resolve(base, "examples"), new Set([".json"]));
  const openapiPath = resolve(base, "openapi/project-onboarding-evidence-api.v1.yaml");
  const publishedPath = resolve(base, "openapi/project-onboarding-api.v1.1.yaml");
  const asyncapiPath = resolve(base, "asyncapi/project-onboarding-evidence-events.v1.yaml");
  const documents: ContractDocument[] = [];
  for (const path of [...schemaPaths, ...examplePaths, openapiPath, publishedPath, asyncapiPath]) {
    try {
      documents.push({
        path,
        value: extname(path) === ".json" ? parseJsonWithDuplicateDetection(path) : parseYaml(path),
      });
    } catch (error) {
      errors.push(
        `${relative(root, path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const byPath = new Map(documents.map(({ path, value }) => [path, value]));
  const byId = new Map<string, ContractDocument>();
  const idByPath = new Map<string, string>();
  for (const path of schemaPaths) {
    const value = byPath.get(path);
    const id = record(value).$id;
    if (typeof id !== "string" || !id.startsWith("urn:awp:schemas:007:"))
      errors.push(`${relative(root, path)} has no immutable Feature 007 $id`);
    else if (byId.has(id)) errors.push(`duplicate immutable schema id ${id}`);
    else {
      byId.set(id, { path, value });
      idByPath.set(path, id);
    }
  }

  let referenceCount = 0;
  for (const document of documents) {
    for (const reference of refs(document.value)) {
      referenceCount += 1;
      try {
        if (/^https?:/iu.test(reference)) throw new Error(`remote $ref forbidden: ${reference}`);
        const hashIndex = reference.indexOf("#");
        const target = hashIndex < 0 ? reference : reference.slice(0, hashIndex);
        const fragment = hashIndex < 0 ? "" : reference.slice(hashIndex + 1);
        if (target.startsWith("urn:")) {
          const destination = byId.get(target);
          if (!destination) throw new Error(`unknown immutable $ref ${reference}`);
          resolvePointer(destination.value, fragment);
          continue;
        }
        if (target && /^[a-z][a-z0-9+.-]*:/iu.test(target))
          throw new Error(`non-local $ref forbidden: ${reference}`);
        const targetPath = target ? resolve(dirname(document.path), target) : document.path;
        if (targetPath !== root && !targetPath.startsWith(`${root}/`))
          throw new Error(`$ref escapes workspace: ${reference}`);
        let destination = byPath.get(targetPath);
        if (
          destination === undefined &&
          existsSync(targetPath) &&
          [".json", ".yaml", ".yml"].includes(extname(targetPath))
        ) {
          destination =
            extname(targetPath) === ".json"
              ? parseJsonWithDuplicateDetection(targetPath)
              : parseYaml(targetPath);
          byPath.set(targetPath, destination);
        }
        if (!destination) throw new Error(`unresolved local $ref ${reference}`);
        resolvePointer(destination, fragment);
      } catch (error) {
        errors.push(
          `${relative(root, document.path)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const schemaDigests: Record<string, string> = {};
  const digestOwners = new Map<string, string>();
  for (const path of schemaPaths) {
    const schema = byPath.get(path);
    if (!schema) continue;
    try {
      const canonical = canonicalize007Contract(schema);
      if (canonicalize007Contract(JSON.parse(canonical)) !== canonical)
        errors.push(`${relative(root, path)} has unstable JCS bytes`);
      const contentDigest = sha256(canonical);
      const id = record(schema).$id;
      if (typeof id === "string") schemaDigests[id] = contentDigest;
      const owner = digestOwners.get(contentDigest);
      if (owner)
        errors.push(`${relative(root, path)} duplicates JCS schema digest owned by ${owner}`);
      else digestOwners.set(contentDigest, relative(root, path));
    } catch (error) {
      errors.push(
        `${relative(root, path)} JCS failure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
    validateFormats: true,
  });
  addFormats(ajv);
  for (const path of schemaPaths) {
    const schema = byPath.get(path);
    if (!schema) continue;
    try {
      ajv.addSchema(rewriteSchemaRefs(schema, path, idByPath) as boolean | object);
    } catch (error) {
      errors.push(
        `${relative(root, path)} strict registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const path of schemaPaths) {
    const id = record(byPath.get(path)).$id;
    if (typeof id !== "string") continue;
    try {
      if (!ajv.getSchema(id))
        errors.push(`${relative(root, path)} did not compile as strict JSON Schema 2020-12`);
    } catch (error) {
      errors.push(
        `${relative(root, path)} strict compilation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const positives = Object.freeze([
    ["manual-onboarding-package.json", "urn:awp:schemas:007:project-onboarding-package:v1"],
    ["full-qa-evidence-package.json", "urn:awp:schemas:007:evidence-package:v1"],
    ["suspended-project.json", "urn:awp:schemas:007:project-onboarding-package:v1"],
  ] as const);
  const negatives = Object.freeze([
    ["secret-bearing-environment.json", "urn:awp:schemas:007:project-environment-revision:v1"],
    ["production-target.json", "urn:awp:schemas:007:project-environment-revision:v1"],
    ["mutable-evidence-correction.json", "urn:awp:schemas:007:evidence-manifest:v2"],
    ["self-approved-resume.json", "urn:awp:schemas:007:project-operational-action:v1"],
  ] as const);
  for (const [name, id] of positives) {
    const value = byPath.get(resolve(base, "examples/positive", name));
    const validate = ajv.getSchema(id);
    if (!validate) errors.push(`${name}: declared schema ${id} is unavailable`);
    else if (!validate(value))
      errors.push(`${name}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  }
  for (const [name, id] of negatives) {
    const value = byPath.get(resolve(base, "examples/negative", name));
    const validate = ajv.getSchema(id);
    if (!validate) errors.push(`${name}: declared schema ${id} is unavailable`);
    else if (validate(value)) errors.push(`${name}: negative fixture unexpectedly validated`);
  }

  const openapiOperations = operationIds(
    byPath.get(openapiPath) as JsonRecord | undefined,
    errors,
  ).length;
  const publishedOpenapiOperations = operationIds(
    byPath.get(publishedPath) as JsonRecord | undefined,
    errors,
    [
      ...expectedOpenapiOperations.filter(
        (id) =>
          !["verifyEvidenceManifest", "getEvidencePackage", "exportEvidencePackage"].includes(id),
      ),
      "replaceProjectEntitlement",
    ],
  ).length;
  const asyncapi = validateAsyncapi(byPath.get(asyncapiPath) as JsonRecord | undefined, errors);
  if (schemaPaths.length !== 16)
    errors.push(`JSON Schema count is ${schemaPaths.length}; expected 16`);
  if (examplePaths.length !== 7) errors.push(`example count is ${examplePaths.length}; expected 7`);

  return Object.freeze({
    status: errors.length === 0 ? "PASS" : "FAIL",
    schemas: schemaPaths.length,
    examples: examplePaths.length,
    positiveExamples: positives.length,
    negativeExamples: negatives.length,
    references: referenceCount,
    schemaDigests: Object.freeze(schemaDigests),
    openapiOperations,
    publishedOpenapiOperations,
    asyncapiChannels: asyncapi.channels,
    asyncapiOperations: asyncapi.operations,
    errors: Object.freeze(errors),
  });
}

function writeAtomic(value: Readonly<Record<string, unknown>>): void {
  const target = resolve(workspace, reportPath);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(value, workspace), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function run(): void {
  const startedAt = new Date();
  const result = verify007Contracts();
  writeAtomic(
    Object.freeze({
      schemaVersion: 1,
      feature: "007-project-onboarding-evidence-security",
      gate: "contracts",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ...result,
    }),
  );
  console.log(
    `[contracts:007] ${result.status}; schemas=${result.schemas}; examples=${result.positiveExamples}/${result.negativeExamples}; refs=${result.references}; openapi=${result.openapiOperations}; asyncapi=${result.asyncapiChannels}/${result.asyncapiOperations}`,
  );
  for (const error of result.errors) console.error(`- ${error}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
