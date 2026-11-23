import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

interface ContractDocument {
  readonly path: string;
  readonly value: unknown;
}

export interface Feature004ContractVerificationResult {
  readonly status: "PASS" | "FAIL";
  readonly schemas: number;
  readonly examples: number;
  readonly references: number;
  readonly openapiOperations: number;
  readonly asyncapiChannels: number;
  readonly asyncapiMessages: number;
  readonly aeadVectors: number;
  readonly errors: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const contractRoot = "specs/004-mattermost-hermes-intake/contracts";

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

function verifyAeadVector(value: unknown, aadSchema: unknown): readonly string[] {
  const errors: string[] = [];
  const vector = value as Record<string, unknown>;
  const aad = vector.aad as Record<string, unknown>;
  try {
    const key = Buffer.from(String(vector.keyHex), "hex");
    const nonce = Buffer.from(String(vector.aeadNonceHex), "hex");
    const plaintext = Buffer.from(String(vector.plaintextUtf8), "utf8");
    const aadBytes = Buffer.from(canonicalize(aad), "utf8");
    const schemaDigest = sha256(canonicalize(aadSchema));
    const schemaRef = aad.schemaRef as Record<string, unknown>;
    if (key.length !== 32) errors.push("AEAD vector key must contain exactly 32 bytes");
    if (nonce.length !== 12) errors.push("AEAD vector nonce must contain exactly 12 bytes");
    if (plaintext.toString("hex") !== vector.plaintextHex)
      errors.push("AEAD plaintext UTF-8/hex mismatch");
    if (sha256(plaintext) !== vector.tokenHash) errors.push("AEAD tokenHash mismatch");
    const intent = aad.intent as Record<string, unknown>;
    if (sha256(plaintext) !== intent.nonceHash) errors.push("AEAD historical nonceHash mismatch");
    if (sha256(aadBytes) !== vector.aadHash) errors.push("AEAD aadHash mismatch");
    if (schemaRef.digest !== schemaDigest)
      errors.push(`AEAD AAD schema digest mismatch: expected ${schemaDigest}`);

    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(aadBytes);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    if (ciphertext.toString("hex") !== vector.ciphertextHex)
      errors.push("AEAD ciphertext mismatch");
    if (tag.toString("hex") !== vector.authTagHex) errors.push("AEAD authentication tag mismatch");
    if (sha256(ciphertext) !== vector.ciphertextHash) errors.push("AEAD ciphertextHash mismatch");

    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aadBytes);
    decipher.setAuthTag(tag);
    const recovered = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (!recovered.equals(plaintext)) errors.push("AEAD decrypt round-trip mismatch");
  } catch (error) {
    errors.push(
      `AEAD vector verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return errors;
}

export function verify004Contracts(root = workspace): Feature004ContractVerificationResult {
  const base = resolve(root, contractRoot);
  const errors: string[] = [];
  if (!existsSync(base)) {
    return Object.freeze({
      status: "FAIL",
      schemas: 0,
      examples: 0,
      references: 0,
      openapiOperations: 0,
      asyncapiChannels: 0,
      asyncapiMessages: 0,
      aeadVectors: 0,
      errors: Object.freeze([`${contractRoot} is missing`]),
    });
  }

  const schemaPaths = files(resolve(base, "schemas"), new Set([".json"]));
  const examplePaths = files(resolve(base, "examples"), new Set([".json"]));
  const openapiPath = resolve(base, "openapi/mattermost-hermes-intake-api.v1.yaml");
  const asyncapiPath = resolve(base, "asyncapi/mattermost-hermes-events.v1.yaml");
  const allPaths = [...schemaPaths, ...examplePaths, openapiPath, asyncapiPath];
  const documents: ContractDocument[] = [];
  for (const path of allPaths) {
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

  const examples = [
    ["guided-intake.local.v1.json", "urn:awp:schemas:004:intake-draft-revision:v1.1"],
    [
      "interaction-presentation-aead.vector.v1.json",
      "urn:awp:schemas:004:interaction-presentation-aead-vector:v1",
    ],
    ["mattermost-pilot-metadata.local.v1.json", "urn:awp:schemas:004:mattermost-pilot-metadata:v1"],
  ] as const;
  for (const [name, id] of examples) {
    const path = resolve(base, "examples", name);
    const value = byPath.get(path);
    try {
      const validate = ajv.getSchema(id);
      if (!validate) errors.push(`${name}: declared schema ${id} is unavailable`);
      else if (!validate(value))
        errors.push(`${name}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
    } catch (error) {
      errors.push(
        `${name}: example validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const openapi = byPath.get(openapiPath) as Record<string, unknown> | undefined;
  let openapiOperations = 0;
  if (!openapi || openapi.openapi !== "3.1.0")
    errors.push("Feature 004 OpenAPI 3.1 document is missing or incompatible");
  else {
    const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    const paths = openapi.paths as Record<string, unknown>;
    const operationIds = new Set<string>();
    for (const item of Object.values(paths)) {
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
    if (openapiOperations !== 20)
      errors.push(`OpenAPI operation count is ${openapiOperations}; expected 20`);
  }

  const asyncapi = byPath.get(asyncapiPath) as Record<string, unknown> | undefined;
  let asyncapiChannels = 0;
  let asyncapiMessages = 0;
  if (!asyncapi || asyncapi.asyncapi !== "3.0.0")
    errors.push("Feature 004 AsyncAPI 3.0 document is missing or incompatible");
  else {
    asyncapiChannels = Object.keys(asyncapi.channels as Record<string, unknown>).length;
    const components = asyncapi.components as Record<string, unknown>;
    asyncapiMessages = Object.keys(components.messages as Record<string, unknown>).length;
    if (asyncapiChannels !== 5)
      errors.push(`AsyncAPI channel count is ${asyncapiChannels}; expected 5`);
    if (asyncapiMessages !== 20)
      errors.push(`AsyncAPI message count is ${asyncapiMessages}; expected 20`);
  }

  const vector = byPath.get(resolve(base, "examples/interaction-presentation-aead.vector.v1.json"));
  const aadSchema = byPath.get(
    resolve(base, "schemas/interaction-presentation-aad.v1.schema.json"),
  );
  if (vector === undefined || aadSchema === undefined)
    errors.push("AEAD golden vector or AAD schema is missing");
  else errors.push(...verifyAeadVector(vector, aadSchema));

  if (schemaPaths.length !== 43)
    errors.push(`JSON Schema count is ${schemaPaths.length}; expected 43`);
  if (examplePaths.length !== 3) errors.push(`example count is ${examplePaths.length}; expected 3`);
  return Object.freeze({
    status: errors.length === 0 ? "PASS" : "FAIL",
    schemas: schemaPaths.length,
    examples: examplePaths.length,
    references: referenceCount,
    openapiOperations,
    asyncapiChannels,
    asyncapiMessages,
    aeadVectors: vector === undefined ? 0 : 1,
    errors: Object.freeze(errors),
  });
}

function run(): void {
  const result = verify004Contracts();
  console.log(
    `[contracts:004] ${result.status}; schemas=${result.schemas}; examples=${result.examples}; refs=${result.references}; openapi=${result.openapiOperations}; asyncapi=${result.asyncapiChannels}/${result.asyncapiMessages}; aead=${result.aeadVectors}`,
  );
  for (const error of result.errors) console.error(`- ${error}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
