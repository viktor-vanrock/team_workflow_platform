import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

interface ContractDocument {
  readonly path: string;
  readonly value: unknown;
}

export interface Feature006ContractVerificationResult {
  readonly status: "PASS" | "FAIL";
  readonly schemas: number;
  readonly examples: number;
  readonly positiveExamples: number;
  readonly negativeExamples: number;
  readonly references: number;
  readonly schemaDigests: Readonly<Record<string, string>>;
  readonly queueOpenapiOperations: number;
  readonly approvalOpenapiOperations: number;
  readonly asyncapiChannels: number;
  readonly asyncapiMessages: number;
  readonly semanticVectors: number;
  readonly errors: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const contractRoot = "specs/006-queue-triage-capacity-sla/contracts";
const dependencySchemas = Object.freeze([
  "specs/001-extension-kernel-local-skeleton/contracts/schemas/common/actor-ref.v1.schema.json",
  "specs/001-extension-kernel-local-skeleton/contracts/schemas/common/versioned-ref.v1.schema.json",
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
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child),
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
    current = (current as Record<string, unknown>)[key];
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS cannot encode a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`JCS cannot encode ${typeof value}`);
}

function sha256(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isValidDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function addFormats(ajv: Ajv2020): void {
  ajv.addFormat("date", { type: "string", validate: isValidDate });
  ajv.addFormat("date-time", { type: "string", validate: isValidDateTime });
  ajv.addFormat("uuid", {
    type: "string",
    validate: (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value),
  });
  ajv.addFormat("uri", {
    type: "string",
    validate: (value: string) => {
      try {
        return new URL(value).protocol.length > 1;
      } catch {
        return false;
      }
    },
  });
}

function operationCount(
  document: Record<string, unknown> | undefined,
  label: string,
  expected: number,
  errors: string[],
): number {
  if (!document || document.openapi !== "3.1.0") {
    errors.push(`${label} OpenAPI 3.1 document is missing or incompatible`);
    return 0;
  }
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  const operationIds = new Set<string>();
  let count = 0;
  for (const item of Object.values((document.paths ?? {}) as Record<string, unknown>)) {
    if (!item || typeof item !== "object") continue;
    for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
      if (!methods.has(method)) continue;
      count += 1;
      const id =
        operation && typeof operation === "object"
          ? (operation as Record<string, unknown>).operationId
          : undefined;
      if (typeof id !== "string" || id.length === 0)
        errors.push(`${label} OpenAPI ${method} operation has no operationId`);
      else if (operationIds.has(id)) errors.push(`${label} duplicate OpenAPI operationId ${id}`);
      else operationIds.add(id);
    }
  }
  if (count !== expected)
    errors.push(`${label} OpenAPI operation count is ${count}; expected ${expected}`);
  return count;
}

function hasUniqueOverrideDates(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const overrides = (value as Record<string, unknown>).dateOverrides;
  if (!Array.isArray(overrides)) return false;
  const dates = overrides.map((entry) =>
    entry && typeof entry === "object" ? (entry as Record<string, unknown>).date : undefined,
  );
  return dates.every((date) => typeof date === "string") && new Set(dates).size === dates.length;
}

export function verify006Contracts(root = workspace): Feature006ContractVerificationResult {
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
      queueOpenapiOperations: 0,
      approvalOpenapiOperations: 0,
      asyncapiChannels: 0,
      asyncapiMessages: 0,
      semanticVectors: 0,
      errors: Object.freeze([`${contractRoot} is missing`]),
    });
  }

  const schemaPaths = files(resolve(base, "schemas"), new Set([".json"]));
  const examplePaths = files(resolve(base, "examples"), new Set([".json"]));
  const dependencyPaths = dependencySchemas.map((path) => resolve(root, path));
  const queueOpenapiPath = resolve(base, "openapi/queue-triage-capacity-sla-api.v1.yaml");
  const approvalOpenapiPath = resolve(base, "openapi/core-approval-api.v1.1.yaml");
  const asyncapiPath = resolve(base, "asyncapi/queue-triage-capacity-sla-events.v1.yaml");
  const documents: ContractDocument[] = [];
  for (const path of [
    ...dependencyPaths,
    ...schemaPaths,
    ...examplePaths,
    queueOpenapiPath,
    approvalOpenapiPath,
    asyncapiPath,
  ]) {
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
  for (const path of [...dependencyPaths, ...schemaPaths]) {
    const value = byPath.get(path);
    const id =
      value && typeof value === "object" ? (value as Record<string, unknown>).$id : undefined;
    if (typeof id !== "string" || !id.startsWith("urn:awp:"))
      errors.push(`${relative(root, path)} has no immutable AWP $id`);
    else if (byId.has(id)) errors.push(`duplicate immutable schema id ${id}`);
    else byId.set(id, { path, value });
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
        } else {
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
        }
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
      const canonical = canonicalize(schema);
      if (canonicalize(JSON.parse(canonical)) !== canonical)
        errors.push(`${relative(root, path)} has unstable JCS bytes`);
      const digest = sha256(canonical);
      const id = (schema as Record<string, unknown>).$id;
      if (typeof id === "string") schemaDigests[id] = digest;
      const owner = digestOwners.get(digest);
      if (owner)
        errors.push(`${relative(root, path)} duplicates JCS schema digest owned by ${owner}`);
      else digestOwners.set(digest, relative(root, path));
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
  for (const path of [...dependencyPaths, ...schemaPaths]) {
    const schema = byPath.get(path);
    if (!schema) continue;
    try {
      ajv.addSchema(schema);
    } catch (error) {
      errors.push(
        `${relative(root, path)} strict registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const path of schemaPaths) {
    const schema = byPath.get(path) as Record<string, unknown> | undefined;
    const id = schema?.$id;
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
    ["business-calendar-utc-midnight.v1.json", "urn:awp:schemas:006:business-calendar:v1"],
    ["qa-queue-facts-changed.v1.json", "urn:awp:schemas:006:qa-queue-facts-changed:v1"],
    ["sla-warning-threshold-emission.v1.json", "urn:awp:schemas:006:sla-threshold-emission:v1"],
    ["sla-not-started-measure-only-with-policy.v1.json", "urn:awp:schemas:006:sla-snapshot:v1"],
  ] as const);
  for (const [name, id] of positives) {
    const value = byPath.get(resolve(base, "examples/positive", name));
    const validate = ajv.getSchema(id);
    if (!validate) errors.push(`${name}: declared schema ${id} is unavailable`);
    else if (!validate(value))
      errors.push(`${name}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  }

  const negatives = Object.freeze([
    ["capacity-admission-global-head-leak.v1.json", "urn:awp:schemas:006:capacity-admission:v1"],
    [
      "business-calendar-invalid-start-midnight.v1.json",
      "urn:awp:schemas:006:business-calendar:v1",
    ],
    ["triage-assessment-wrapper-dimension.v1.1.json", "urn:awp:schemas:004:triage-assessment:v1.1"],
    ["sla-not-started-measure-only-missing-policy.v1.json", "urn:awp:schemas:006:sla-snapshot:v1"],
  ] as const);
  for (const [name, id] of negatives) {
    const value = byPath.get(resolve(base, "examples/negative", name));
    const validate = ajv.getSchema(id);
    if (!validate) errors.push(`${name}: declared schema ${id} is unavailable`);
    else if (validate(value)) errors.push(`${name}: negative fixture unexpectedly validated`);
  }

  let semanticVectors = 0;
  const duplicateCalendarName = "business-calendar-duplicate-date-override.v1.json";
  const duplicateCalendar = byPath.get(resolve(base, "examples/negative", duplicateCalendarName));
  const validateCalendar = ajv.getSchema("urn:awp:schemas:006:business-calendar:v1");
  semanticVectors += 1;
  if (!validateCalendar || !validateCalendar(duplicateCalendar))
    errors.push(`${duplicateCalendarName}: semantic-negative fixture must pass raw JSON Schema`);
  else if (hasUniqueOverrideDates(duplicateCalendar))
    errors.push(
      `${duplicateCalendarName}: composed validator did not observe duplicate override dates`,
    );

  const queueOpenapi = byPath.get(queueOpenapiPath) as Record<string, unknown> | undefined;
  const approvalOpenapi = byPath.get(approvalOpenapiPath) as Record<string, unknown> | undefined;
  const queueOpenapiOperations = operationCount(queueOpenapi, "queue", 11, errors);
  const approvalOpenapiOperations = operationCount(approvalOpenapi, "approval", 2, errors);

  const asyncapi = byPath.get(asyncapiPath) as Record<string, unknown> | undefined;
  let asyncapiChannels = 0;
  let asyncapiMessages = 0;
  if (!asyncapi || asyncapi.asyncapi !== "3.0.0")
    errors.push("Feature 006 AsyncAPI 3.0 document is missing or incompatible");
  else {
    asyncapiChannels = Object.keys((asyncapi.channels ?? {}) as Record<string, unknown>).length;
    const components = (asyncapi.components ?? {}) as Record<string, unknown>;
    asyncapiMessages = Object.keys((components.messages ?? {}) as Record<string, unknown>).length;
    if (asyncapiChannels !== 6)
      errors.push(`AsyncAPI channel count is ${asyncapiChannels}; expected 6`);
    if (asyncapiMessages !== 15)
      errors.push(`AsyncAPI message count is ${asyncapiMessages}; expected 15`);
  }

  if (schemaPaths.length !== 16)
    errors.push(`JSON Schema count is ${schemaPaths.length}; expected 16`);
  if (examplePaths.length !== 9) errors.push(`example count is ${examplePaths.length}; expected 9`);
  return Object.freeze({
    status: errors.length === 0 ? "PASS" : "FAIL",
    schemas: schemaPaths.length,
    examples: examplePaths.length,
    positiveExamples: positives.length,
    negativeExamples: negatives.length + 1,
    references: referenceCount,
    schemaDigests: Object.freeze(schemaDigests),
    queueOpenapiOperations,
    approvalOpenapiOperations,
    asyncapiChannels,
    asyncapiMessages,
    semanticVectors,
    errors: Object.freeze(errors),
  });
}

function run(): void {
  const result = verify006Contracts();
  console.log(
    `[contracts:006] ${result.status}; schemas=${result.schemas}; examples=${result.positiveExamples}/${result.negativeExamples}; refs=${result.references}; openapi=${result.queueOpenapiOperations}+${result.approvalOpenapiOperations}; asyncapi=${result.asyncapiChannels}/${result.asyncapiMessages}; semantic=${result.semanticVectors}`,
  );
  for (const error of result.errors) console.error(`- ${error}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
