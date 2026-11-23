import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

interface ContractDocument {
  readonly path: string;
  readonly value: unknown;
}

export interface Feature005ContractVerificationResult {
  readonly status: "PASS" | "FAIL";
  readonly schemas: number;
  readonly examples: number;
  readonly positiveExamples: number;
  readonly negativeExamples: number;
  readonly references: number;
  readonly openapiOperations: number;
  readonly asyncapiChannels: number;
  readonly asyncapiMessages: number;
  readonly semanticVectors: number;
  readonly errors: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const contractRoot = "specs/005-gitlab-automated-validation/contracts";

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

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : references(child),
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

function sha256(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rootContentHash(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("root hash input must be an object");
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy.contentHash;
  return sha256(canonicalize(copy));
}

function keywordMatches(
  errors: readonly ErrorObject[] | null | undefined,
  expected: string,
): boolean {
  const normalized = expected.toLowerCase();
  return (errors ?? []).some(
    (error) =>
      error.keyword.toLowerCase() === normalized ||
      (error.message ?? "").toLowerCase().includes(normalized),
  );
}

function secretMaterialPath(
  value: unknown,
  path = "$",
  seen = new Set<object>(),
): string | undefined {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && /^(?:Bearer|Basic)\s+/iu.test(value) ? path : undefined;
  }
  if (seen.has(value)) return path;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = secretMaterialPath(value[index], `${path}[${index}]`, seen);
      if (found) return found;
    }
  } else {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        /^(?:accessToken|apiToken|authorization|clientSecret|cookie|password|privateKey|secret|secretValue|token)$/iu.test(
          key,
        )
      )
        return `${path}.${key}`;
      const found = secretMaterialPath(child, `${path}.${key}`, seen);
      if (found) return found;
    }
  }
  seen.delete(value);
  return undefined;
}

export function verify005Contracts(root = workspace): Feature005ContractVerificationResult {
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
      openapiOperations: 0,
      asyncapiChannels: 0,
      asyncapiMessages: 0,
      semanticVectors: 0,
      errors: Object.freeze([`${contractRoot} is missing`]),
    });
  }

  const schemaPaths = files(resolve(base, "schemas"), new Set([".json"]));
  const examplePaths = files(resolve(base, "examples"), new Set([".json"]));
  const openapiPath = resolve(base, "openapi/gitlab-automated-validation-api.v1.yaml");
  const asyncapiPath = resolve(base, "asyncapi/gitlab-automated-validation-events.v1.yaml");
  const documents: ContractDocument[] = [];
  for (const path of [...schemaPaths, ...examplePaths, openapiPath, asyncapiPath]) {
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
  for (const path of schemaPaths) {
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
    for (const reference of references(document.value)) {
      referenceCount += 1;
      try {
        if (/^https?:/iu.test(reference)) throw new Error(`remote $ref forbidden: ${reference}`);
        const [target = "", fragment = ""] = reference.split("#", 2);
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

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
    validateFormats: false,
  });
  for (const path of schemaPaths) {
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
  for (const [id, document] of byId) {
    try {
      if (!ajv.getSchema(id))
        errors.push(
          `${relative(root, document.path)} did not compile as strict JSON Schema 2020-12`,
        );
    } catch (error) {
      errors.push(
        `${relative(root, document.path)} strict compilation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const positives = [
    ["automated-session.local.v1.json", "urn:awp:schemas:005:automated-test-session:v1"],
    [
      "gitlab-connection-configuration.local.v1.json",
      "urn:awp:schemas:005:gitlab-connection-configuration:v1",
    ],
    ["gitlab-pilot-metadata.local.v1.json", "urn:awp:schemas:005:gitlab-pilot-metadata:v1"],
    ["pipeline-result.pass.v1.json", "urn:awp:schemas:005:gitlab-pipeline-result:v1"],
  ] as const;
  for (const [name, id] of positives) {
    const value = byPath.get(resolve(base, "examples", name));
    const validate = ajv.getSchema(id);
    if (!validate) errors.push(`${name}: declared schema ${id} is unavailable`);
    else if (!validate(value))
      errors.push(`${name}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
    const secretPath = secretMaterialPath(value);
    if (secretPath) errors.push(`${name}: secret material is forbidden at ${secretPath}`);
  }

  const negativeManifestPath = resolve(base, "examples/negative/manifest.v1.json");
  const negativeManifest = byPath.get(negativeManifestPath) as Record<string, unknown> | undefined;
  const negativeCases = Array.isArray(negativeManifest?.cases)
    ? (negativeManifest.cases as readonly Record<string, unknown>[])
    : [];
  for (const entry of negativeCases) {
    const fixture = String(entry.fixture ?? "");
    const schemaId = String(entry.schemaId ?? "");
    const expectedKeyword = String(entry.expectedKeyword ?? "");
    const value = byPath.get(resolve(base, "examples/negative", fixture));
    const validate = ajv.getSchema(schemaId);
    if (!validate) errors.push(`${fixture}: declared schema ${schemaId} is unavailable`);
    else if (validate(value)) errors.push(`${fixture}: negative fixture unexpectedly validated`);
    else if (!keywordMatches(validate.errors, expectedKeyword))
      errors.push(`${fixture}: rejection did not include keyword ${expectedKeyword}`);
  }

  let semanticVectors = 0;
  const metadata = byPath.get(resolve(base, "examples/gitlab-pilot-metadata.local.v1.json")) as
    Record<string, unknown> | undefined;
  if (metadata) {
    semanticVectors += 1;
    if (rootContentHash(metadata) !== metadata.contentHash)
      errors.push("gitlab-pilot-metadata.local.v1.json: root JCS contentHash mismatch");
    const identities = metadata.identities as Record<string, Record<string, unknown>>;
    const slots = [identities.read, identities.trigger, identities.webhook];
    if (
      new Set(slots.map((slot) => slot?.secretRef)).size !== 3 ||
      new Set(slots.map((slot) => slot?.credentialFingerprint)).size !== 3
    ) {
      errors.push(
        "gitlab-pilot-metadata.local.v1.json: identity refs/fingerprints must be distinct",
      );
    }
    const resultSchema = byId.get("urn:awp:schemas:005:gitlab-pipeline-result:v1")?.value;
    const declaredDigest = (
      (metadata.resultContract as Record<string, unknown>).schemaRef as Record<string, unknown>
    ).digest;
    if (resultSchema && sha256(canonicalize(resultSchema)) !== declaredDigest)
      errors.push("gitlab-pilot-metadata.local.v1.json: result schema digest mismatch");
  }
  const pipeline = byPath.get(resolve(base, "examples/pipeline-result.pass.v1.json")) as
    Record<string, unknown> | undefined;
  if (pipeline) {
    semanticVectors += 1;
    const artifact = (pipeline.artifacts as readonly Record<string, unknown>[])[0];
    const bytes = readFileSync(resolve(base, "examples/artifacts/junit.xml"));
    if (!artifact || artifact.byteSize !== bytes.byteLength || artifact.checksum !== sha256(bytes))
      errors.push("pipeline-result.pass.v1.json: detached JUnit size/checksum mismatch");
  }

  const openapi = byPath.get(openapiPath) as Record<string, unknown> | undefined;
  let openapiOperations = 0;
  if (!openapi || openapi.openapi !== "3.1.0")
    errors.push("Feature 005 OpenAPI 3.1 document is missing or incompatible");
  else {
    const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    const operationIds = new Set<string>();
    for (const item of Object.values(openapi.paths as Record<string, unknown>)) {
      if (!item || typeof item !== "object") continue;
      for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
        if (!methods.has(method)) continue;
        openapiOperations += 1;
        const id =
          operation && typeof operation === "object"
            ? (operation as Record<string, unknown>).operationId
            : undefined;
        if (typeof id !== "string" || id.length === 0)
          errors.push(`OpenAPI ${method} operation has no operationId`);
        else if (operationIds.has(id)) errors.push(`duplicate OpenAPI operationId ${id}`);
        else operationIds.add(id);
      }
    }
    if (openapiOperations !== 21)
      errors.push(`OpenAPI operation count is ${openapiOperations}; expected 21`);
  }

  const asyncapi = byPath.get(asyncapiPath) as Record<string, unknown> | undefined;
  let asyncapiChannels = 0;
  let asyncapiMessages = 0;
  if (!asyncapi || asyncapi.asyncapi !== "3.0.0")
    errors.push("Feature 005 AsyncAPI 3.0 document is missing or incompatible");
  else {
    asyncapiChannels = Object.keys(asyncapi.channels as Record<string, unknown>).length;
    const components = asyncapi.components as Record<string, unknown>;
    asyncapiMessages = Object.keys(components.messages as Record<string, unknown>).length;
    if (asyncapiChannels !== 3)
      errors.push(`AsyncAPI channel count is ${asyncapiChannels}; expected 3`);
    if (asyncapiMessages !== 6)
      errors.push(`AsyncAPI message count is ${asyncapiMessages}; expected 6`);
  }

  if (schemaPaths.length !== 31)
    errors.push(`JSON Schema count is ${schemaPaths.length}; expected 31`);
  if (positives.length !== 4)
    errors.push(`positive example count is ${positives.length}; expected 4`);
  if (negativeCases.length !== 4)
    errors.push(`negative example count is ${negativeCases.length}; expected 4`);
  return Object.freeze({
    status: errors.length === 0 ? "PASS" : "FAIL",
    schemas: schemaPaths.length,
    examples: examplePaths.length,
    positiveExamples: positives.length,
    negativeExamples: negativeCases.length,
    references: referenceCount,
    openapiOperations,
    asyncapiChannels,
    asyncapiMessages,
    semanticVectors,
    errors: Object.freeze(errors),
  });
}

function run(): void {
  const result = verify005Contracts();
  console.log(
    `[contracts:005] ${result.status}; schemas=${result.schemas}; examples=${result.positiveExamples}/${result.negativeExamples}; refs=${result.references}; openapi=${result.openapiOperations}; asyncapi=${result.asyncapiChannels}/${result.asyncapiMessages}; semantic=${result.semanticVectors}`,
  );
  for (const error of result.errors) console.error(`- ${error}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
