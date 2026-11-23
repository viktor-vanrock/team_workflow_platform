import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import { canonicalize, type JsonValue, sha256, type Sha256Digest } from "./canonical-hash.ts";
import { type GeneratedSchemaDocument, schemaDocuments } from "./generated/schema-documents.ts";

export interface SchemaReference {
  readonly id: string;
  readonly version: number;
  readonly digest: Sha256Digest;
}

export interface SchemaBoundValue<T = JsonValue> {
  readonly schemaRef: SchemaReference;
  readonly value: T;
}

export class SchemaValidationError extends Error {
  readonly schemaId: string;
  readonly errors: readonly ErrorObject[];
  constructor(schemaId: string, errors: readonly ErrorObject[]) {
    super(
      `Value does not conform to ${schemaId}: ${errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`).join("; ")}`,
    );
    this.schemaId = schemaId;
    this.errors = errors;
    this.name = "SchemaValidationError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertOfflineReferences(value: unknown, knownIds: ReadonlySet<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      assertOfflineReferences(item, knownIds);
    });
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref" && typeof child === "string") {
      if (/^https?:/iu.test(child))
        throw new Error(`Remote schema reference is forbidden: ${child}`);
      if (child.startsWith("urn:")) {
        const id = child.split("#", 1)[0]!;
        if (!knownIds.has(id)) throw new Error(`Unknown immutable schema reference: ${child}`);
      }
    }
    assertOfflineReferences(child, knownIds);
  }
}

export class OfflineSchemaRegistry {
  readonly #ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
    validateFormats: false,
  });
  readonly #documents = new Map<string, GeneratedSchemaDocument>();
  readonly #validators = new Map<string, ValidateFunction>();

  constructor(documents: readonly GeneratedSchemaDocument[] = schemaDocuments) {
    const ids = new Set(documents.map((document) => document.id));
    for (const document of documents) this.register(document, ids);
  }

  register(
    document: GeneratedSchemaDocument,
    knownIds = new Set([...this.#documents.keys(), document.id]),
  ): void {
    const current = this.#documents.get(document.id);
    if (current !== undefined) {
      if (
        current.digest !== document.digest ||
        canonicalize(current.schema as JsonValue) !== canonicalize(document.schema as JsonValue)
      ) {
        throw new Error(`Schema digest collision for ${document.id}`);
      }
      return;
    }
    assertOfflineReferences(document.schema, knownIds);
    const frozen = deepFreeze({ ...document, schema: structuredClone(document.schema) });
    this.#documents.set(document.id, frozen);
    this.#ajv.addSchema(frozen.schema, frozen.id);
  }

  document(id: string): GeneratedSchemaDocument {
    const document = this.#documents.get(id);
    if (!document) throw new Error(`Unknown schema ${id}`);
    return document;
  }

  validate<T>(bound: SchemaBoundValue<T>): T {
    const document = this.document(bound.schemaRef.id);
    if (document.digest !== bound.schemaRef.digest)
      throw new Error(`Schema digest mismatch for ${bound.schemaRef.id}`);
    return this.validateById(bound.schemaRef.id, bound.value);
  }

  validateById<T>(id: string, value: T): T {
    let validator = this.#validators.get(id);
    if (!validator) {
      validator = this.#ajv.getSchema(id);
      if (!validator) throw new Error(`Schema ${id} was not compiled`);
      this.#validators.set(id, validator);
    }
    if (!validator(value)) throw new SchemaValidationError(id, validator.errors ?? []);
    return value;
  }

  digest(id: string): Sha256Digest {
    return this.document(id).digest;
  }
  contentDigest(value: JsonValue): Sha256Digest {
    return sha256(value);
  }
  ids(): readonly string[] {
    return [...this.#documents.keys()].sort();
  }
}

export const designContractRegistry = new OfflineSchemaRegistry();
