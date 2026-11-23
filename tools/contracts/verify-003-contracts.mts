import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

interface ContractDocument {
  readonly path: string;
  readonly value: unknown;
}

export interface ContractVerificationResult {
  readonly status: "PASS" | "FAIL";
  readonly documents: number;
  readonly references: number;
  readonly actionVectors: number;
  readonly errors: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const contractRoot = "specs/003-jira-operational-authority/contracts";

function parse(path: string): unknown {
  const bytes = readFileSync(path, "utf8");
  if (extname(path) === ".json") return JSON.parse(bytes) as unknown;
  const document = parseDocument(bytes, { strict: true, uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error(document.errors.map(({ message }) => message).join("; "));
  return document.toJS() as unknown;
}

function files(root: string): string[] {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory()
        ? visit(path)
        : [".json", ".yaml", ".yml"].includes(extname(path))
          ? [path]
          : [];
    });
  return visit(root).sort();
}

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : references(child),
  );
}

function resolvePointer(value: unknown, fragment: string): void {
  if (!fragment) return;
  const decoded = decodeURIComponent(fragment);
  if (!decoded.startsWith("/")) throw new Error(`unsupported fragment #${fragment}`);
  let current = value;
  for (const encoded of decoded.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current))
      throw new Error(`unresolved pointer #${fragment}`);
    current = (current as Record<string, unknown>)[key];
  }
}

function actionSchemas(openapi: unknown): Readonly<Record<string, unknown>> {
  const document = openapi as Record<string, unknown>;
  const components = document.components as Record<string, unknown>;
  return components.schemas as Record<string, unknown>;
}

function verifyActionBodies(openapi: unknown): readonly string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const schemas = actionSchemas(openapi);
  const vectors = [
    {
      schema: "TransitionActionInput",
      positive: { targetNormalizedStatus: "READY" },
      negative: [
        { targetNormalizedStatus: "READY", transitionId: "31" },
        { targetNormalizedStatus: "UNKNOWN" },
        { targetNormalizedStatus: "READY", externalRevisionToken: "sha256:x" },
      ],
    },
    {
      schema: "AssignmentActionInput",
      positive: { assignment: { canonicalPrincipalId: "00000000-0000-4000-8000-000000000001" } },
      negative: [
        { assignment: { jiraAccountId: "provider-user" } },
        {
          assignment: {
            unassign: true,
            canonicalPrincipalId: "00000000-0000-4000-8000-000000000001",
          },
        },
      ],
    },
    {
      schema: "PriorityActionInput",
      positive: { normalizedPriorityKey: "HIGH" },
      negative: [{ priorityId: "10000" }, { normalizedPriorityKey: "1-invalid" }],
    },
    {
      schema: "DueDateActionInput",
      positive: { dueDate: "2026-09-01" },
      negative: [{ dueDate: "2026-09-01", fieldId: "duedate" }, { dueDate: 123 }],
    },
  ] as const;
  const errors: string[] = [];
  for (const vector of vectors) {
    const schema = schemas[vector.schema];
    if (!schema) {
      errors.push(`missing action schema ${vector.schema}`);
      continue;
    }
    const validate = ajv.compile(schema);
    if (!validate(vector.positive))
      errors.push(`${vector.schema} rejected positive vector: ${ajv.errorsText(validate.errors)}`);
    for (const [index, negative] of vector.negative.entries())
      if (validate(negative)) errors.push(`${vector.schema} accepted negative vector ${index + 1}`);
  }
  return errors;
}

export function verify003Contracts(root = workspace): ContractVerificationResult {
  const base = resolve(root, contractRoot);
  const errors: string[] = [];
  if (!existsSync(base))
    return Object.freeze({
      status: "FAIL",
      documents: 0,
      references: 0,
      actionVectors: 0,
      errors: Object.freeze([`${contractRoot} is missing`]),
    });
  const paths = files(base);
  const documents: ContractDocument[] = [];
  for (const path of paths) {
    try {
      documents.push({ path, value: parse(path) });
    } catch (error) {
      errors.push(
        `${relative(root, path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const byPath = new Map(documents.map((document) => [document.path, document.value]));
  const byId = new Map<string, ContractDocument>();
  for (const document of documents) {
    if (extname(document.path) !== ".json") continue;
    const id =
      document.value !== null && typeof document.value === "object"
        ? (document.value as Record<string, unknown>).$id
        : undefined;
    const schemaDocument = document.path.includes("/schemas/");
    if (id === undefined) {
      if (schemaDocument) errors.push(`${relative(root, document.path)} has no immutable AWP $id`);
      continue;
    }
    if (typeof id !== "string" || !id.startsWith("urn:awp:")) {
      errors.push(`${relative(root, document.path)} has an invalid immutable AWP $id`);
      continue;
    }
    if (byId.has(id)) errors.push(`duplicate immutable schema id ${id}`);
    else byId.set(id, document);
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
          if (targetPath !== base && !targetPath.startsWith(`${base}/`))
            throw new Error(`$ref escapes contract root: ${reference}`);
          const destination = byPath.get(targetPath);
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
  const openapiPath = resolve(base, "openapi/jira-operational-authority-api.v1.yaml");
  const openapi = byPath.get(openapiPath);
  if (!openapi || (openapi as Record<string, unknown>).openapi !== "3.1.0")
    errors.push("Feature 003 OpenAPI 3.1 document is missing or incompatible");
  else errors.push(...verifyActionBodies(openapi));
  const asyncapiPath = resolve(base, "asyncapi/jira-operational-events.v1.yaml");
  const asyncapi = byPath.get(asyncapiPath);
  if (!asyncapi || (asyncapi as Record<string, unknown>).asyncapi !== "3.0.0")
    errors.push("Feature 003 AsyncAPI 3.0 document is missing or incompatible");
  return Object.freeze({
    status: errors.length === 0 ? "PASS" : "FAIL",
    documents: documents.length,
    references: referenceCount,
    actionVectors: 4,
    errors: Object.freeze(errors),
  });
}

function run(): void {
  const result = verify003Contracts();
  console.log(
    `[contracts:003] ${result.status}; documents=${result.documents}; refs=${result.references}; actionSchemas=${result.actionVectors}`,
  );
  for (const error of result.errors) console.error(`- ${error}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
