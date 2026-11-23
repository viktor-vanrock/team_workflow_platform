import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

import { parseDocument } from "yaml";

import { designContractContributions } from "../../packages/platform-contracts/src/schema-contributions.ts";

const root = resolve(import.meta.dirname, "../..");
const outputPath = resolve(root, "packages/platform-contracts/src/generated/schema-documents.ts");
const httpMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("JSON contracts cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
}

async function findJson(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? findJson(path) : entry.name.endsWith(".json") ? [path] : [];
      }),
    )
  )
    .flat()
    .sort();
}

function withinWorkspace(relativePath: string): string {
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}/`))
    throw new Error(`Contract contribution escapes the workspace: ${relativePath}`);
  return path;
}

const contributions = [...designContractContributions].sort(
  (left, right) => left.order - right.order || left.key.localeCompare(right.key),
);
if (new Set(contributions.map(({ key }) => key)).size !== contributions.length)
  throw new Error("Duplicate design contract contribution key");
if (new Set(contributions.map(({ order }) => order)).size !== contributions.length)
  throw new Error("Duplicate design contract contribution order");

const filesByContribution = new Map<string, readonly string[]>();
for (const contribution of contributions)
  filesByContribution.set(
    contribution.key,
    await findJson(withinWorkspace(contribution.schemaRoot)),
  );

const originals = new Map<string, Record<string, unknown>>();
const idsByPath = new Map<string, string>();
const pathsById = new Map<string, string>();
for (const contribution of contributions) {
  for (const file of filesByContribution.get(contribution.key) ?? []) {
    const document = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const id = document.$id;
    if (typeof id !== "string" || !id.startsWith("urn:awp:"))
      throw new Error(`${file} has no immutable AWP $id`);
    const collision = pathsById.get(id);
    if (collision)
      throw new Error(
        `Duplicate schema id ${id}: ${relative(root, collision)} and ${relative(root, file)}`,
      );
    originals.set(file, document);
    idsByPath.set(file, id);
    pathsById.set(id, file);
  }
}

function resolveReferences(value: unknown, sourcePath: string): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, sourcePath));
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key !== "$ref" || typeof child !== "string" || child.startsWith("#")) {
      output[key] = resolveReferences(child, sourcePath);
      continue;
    }
    if (child.startsWith("urn:")) {
      const [id] = child.split("#", 1);
      if (!id || !pathsById.has(id))
        throw new Error(`${sourcePath}: unresolved immutable $ref ${child}`);
      output[key] = child;
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(child))
      throw new Error(`${sourcePath}: remote $ref is forbidden: ${child}`);
    const [relativePath, fragment = ""] = child.split("#", 2);
    if (!relativePath) throw new Error(`${sourcePath}: invalid relative $ref ${child}`);
    const targetPath = resolve(dirname(sourcePath), relativePath);
    const targetId = idsByPath.get(targetPath);
    if (!targetId) throw new Error(`${sourcePath}: unresolved local $ref ${child}`);
    output[key] = `${targetId}${fragment ? `#${fragment}` : ""}`;
  }
  return output;
}

const documents = contributions.flatMap((contribution) =>
  (filesByContribution.get(contribution.key) ?? []).map((file) => {
    const original = originals.get(file)!;
    const digest = `sha256:${createHash("sha256").update(canonicalize(original)).digest("hex")}`;
    return {
      contributionKey: contribution.key,
      contributionOrder: contribution.order,
      sourcePath: relative(root, file),
      id: idsByPath.get(file)!,
      digest,
      schema: resolveReferences(original, file),
    };
  }),
);

const parsedDocuments = new Map<string, unknown>();
async function parseContractDocument(path: string): Promise<unknown> {
  const cached = parsedDocuments.get(path);
  if (cached !== undefined) return cached;
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  if (extname(path) === ".json") {
    parsed = JSON.parse(text);
  } else {
    const yaml = parseDocument(text, { strict: true, uniqueKeys: true });
    if (yaml.errors.length > 0)
      throw new Error(
        `${relative(root, path)}: ${yaml.errors.map(({ message }) => message).join("; ")}`,
      );
    parsed = yaml.toJS();
  }
  parsedDocuments.set(path, parsed);
  return parsed;
}

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : references(child),
  );
}

function resolvePointer(value: unknown, fragment: string, source: string): void {
  if (fragment === "") return;
  const decoded = decodeURIComponent(fragment);
  if (!decoded.startsWith("/"))
    throw new Error(`${source}: unsupported non-JSON-pointer fragment #${fragment}`);
  let current = value;
  for (const encodedPart of decoded.slice(1).split("/")) {
    const part = encodedPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(part in current))
      throw new Error(`${source}: unresolved JSON pointer #${fragment}`);
    current = (current as Record<string, unknown>)[part];
  }
}

async function validateReferences(path: string, document: unknown): Promise<void> {
  for (const reference of references(document)) {
    if (/^https?:/iu.test(reference))
      throw new Error(`${relative(root, path)}: remote $ref is forbidden: ${reference}`);
    const [target, fragment = ""] = reference.split("#", 2);
    if (target?.startsWith("urn:")) {
      const targetPath = pathsById.get(target);
      if (!targetPath)
        throw new Error(`${relative(root, path)}: unknown immutable $ref ${reference}`);
      resolvePointer(await parseContractDocument(targetPath), fragment, relative(root, path));
      continue;
    }
    if (target && /^[a-z][a-z0-9+.-]*:/iu.test(target))
      throw new Error(`${relative(root, path)}: non-local $ref is forbidden: ${reference}`);
    const targetPath = target ? resolve(dirname(path), target) : path;
    if (targetPath !== root && !targetPath.startsWith(`${root}/`))
      throw new Error(`${relative(root, path)}: $ref escapes the workspace: ${reference}`);
    const targetDocument = await parseContractDocument(targetPath).catch(() => {
      throw new Error(`${relative(root, path)}: unresolved local $ref ${reference}`);
    });
    resolvePointer(targetDocument, fragment, relative(root, path));
  }
}

const operationIds = new Map<string, { path: string; signature?: string }>();
function registerOperationId(
  id: string,
  path: string,
  signature?: string,
  supersedes?: string,
): void {
  if (id.trim().length === 0) throw new Error(`${relative(root, path)}: empty operation id`);
  const collision = operationIds.get(id);
  if (
    collision &&
    !(supersedes === collision.path && signature !== undefined && signature === collision.signature)
  )
    throw new Error(`Duplicate operation id ${id}: ${collision.path} and ${relative(root, path)}`);
  operationIds.set(id, { path: relative(root, path), ...(signature ? { signature } : {}) });
}

function validateOpenApi(path: string, document: unknown): void {
  const rootDocument = document as Record<string, unknown>;
  if (rootDocument.openapi !== "3.1.0")
    throw new Error(`${relative(root, path)}: OpenAPI must be 3.1.0`);
  const paths = rootDocument.paths as Record<string, unknown> | undefined;
  if (!paths) throw new Error(`${relative(root, path)}: OpenAPI paths are missing`);
  for (const [route, pathItemValue] of Object.entries(paths)) {
    if (pathItemValue === null || typeof pathItemValue !== "object") continue;
    for (const [method, operationValue] of Object.entries(
      pathItemValue as Record<string, unknown>,
    )) {
      if (!httpMethods.has(method)) continue;
      const operation = operationValue as Record<string, unknown>;
      if (typeof operation.operationId !== "string")
        throw new Error(
          `${relative(root, path)}: ${method.toUpperCase()} ${route} has no operationId`,
        );
      const supersedes =
        typeof rootDocument["x-awp-supersedes"] === "string"
          ? relative(root, resolve(dirname(path), rootDocument["x-awp-supersedes"]))
          : undefined;
      registerOperationId(operation.operationId, path, `${method}:${route}`, supersedes);
    }
  }
}

function validateAsyncApi(path: string, document: unknown): void {
  const rootDocument = document as Record<string, unknown>;
  if (rootDocument.asyncapi !== "3.0.0")
    throw new Error(`${relative(root, path)}: AsyncAPI must be 3.0.0`);
  const operations = rootDocument.operations as Record<string, unknown> | undefined;
  if (!operations || Object.keys(operations).length === 0)
    throw new Error(`${relative(root, path)}: AsyncAPI operations are missing`);
  for (const operationId of Object.keys(operations))
    registerOperationId(`asyncapi:${operationId}`, path);
}

let yamlDocumentCount = 0;
for (const contribution of contributions) {
  for (const relativePath of contribution.openapiDocuments) {
    const path = withinWorkspace(relativePath);
    const document = await parseContractDocument(path);
    validateOpenApi(path, document);
    await validateReferences(path, document);
    yamlDocumentCount += 1;
  }
  for (const relativePath of contribution.asyncapiDocuments) {
    const path = withinWorkspace(relativePath);
    const document = await parseContractDocument(path);
    validateAsyncApi(path, document);
    await validateReferences(path, document);
    yamlDocumentCount += 1;
  }
}

const generated =
  `/* Generated by tools/contracts/build-registry.mts. Do not edit. */\n` +
  `export interface GeneratedSchemaDocument { readonly contributionKey: string; readonly contributionOrder: number; readonly sourcePath: string; readonly id: string; readonly digest: \`sha256:\${string}\`; readonly schema: Readonly<Record<string, unknown>> }\n\n` +
  `export const schemaDocuments = ${JSON.stringify(documents, null, 2)} as const satisfies readonly GeneratedSchemaDocument[];\n\n` +
  `export type ContractSchemaId = (typeof schemaDocuments)[number]["id"];\n` +
  `export const schemaDocumentById: ReadonlyMap<string, GeneratedSchemaDocument> = new Map(schemaDocuments.map((document) => [document.id, document]));\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated)
    throw new Error("Generated schema registry is stale; run pnpm contracts:build");
  console.log(
    `Contract registry snapshot is current (${documents.length} schemas from ${contributions.length} ordered contributions; ${yamlDocumentCount} YAML documents).`,
  );
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(
    `Generated ${documents.length} immutable schema documents from ${contributions.length} ordered contributions; validated ${yamlDocumentCount} YAML documents.`,
  );
}
