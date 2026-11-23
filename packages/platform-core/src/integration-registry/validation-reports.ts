import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { Clock, IdGenerator, WorkspaceContext } from "../shared/primitives.ts";
import type { ValidationIssue, ValidationReport } from "./model.ts";

export function requireAuthorizationBasis(
  context: WorkspaceContext,
  expected: "WORKSPACE" | "PROJECT",
) {
  const basis = context.authorizationBasis;
  if (!basis || basis.kind !== expected)
    throw new Error(`AUTHORIZATION_BASIS_${expected}_REQUIRED`);
  if (context.scope.kind !== expected) throw new Error(`SCOPE_${expected}_REQUIRED`);
  return basis;
}

export function semanticContentHash(content: JsonValue): Sha256Digest {
  return sha256(content);
}

export function validationIssue(code: string, message: string, path?: string): ValidationIssue {
  return path === undefined
    ? Object.freeze({ code, message })
    : Object.freeze({ code, message, path });
}

export function createValidationReport(input: {
  readonly context: WorkspaceContext;
  readonly subjectKind: ValidationReport["subjectKind"];
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly contentHash: Sha256Digest;
  readonly issues: readonly ValidationIssue[];
  readonly clock: Clock;
  readonly ids: IdGenerator;
}): ValidationReport {
  const expectedBasis = input.subjectKind === "BINDING" ? "PROJECT" : "WORKSPACE";
  const authorizationBasis = requireAuthorizationBasis(input.context, expectedBasis);
  const projectId =
    input.context.scope.kind === "PROJECT" ? input.context.scope.projectId : undefined;
  const base = {
    id: input.ids.next(),
    workspaceId: input.context.scope.workspaceId,
    subjectKind: input.subjectKind,
    subjectRef: { id: input.subjectId, version: input.subjectVersion },
    contentHash: input.contentHash,
    status: input.issues.length === 0 ? ("VALID" as const) : ("INVALID" as const),
    issues: Object.freeze([...input.issues]),
    actorPrincipalId: input.context.actor.principalId,
    authorizationBasis,
    createdAt: input.clock.now(),
  };
  return Object.freeze(projectId === undefined ? base : { ...base, projectId });
}

export function collectValidationIssue(
  issues: ValidationIssue[],
  code: string,
  work: () => void,
): void {
  try {
    work();
  } catch (error) {
    issues.push(validationIssue(code, error instanceof Error ? error.message : String(error)));
  }
}

export function assertSecretReference(value: string): void {
  if (!/^secretref:\/\/[a-z0-9][a-z0-9._/-]*$/iu.test(value))
    throw new Error("RAW_SECRET_FORBIDDEN");
}

export function assertNoRawSecretFields(value: JsonValue, path = "$"): void {
  if (Array.isArray(value)) {
    (value as readonly JsonValue[]).forEach((item, index) => {
      assertNoRawSecretFields(item, `${path}[${index}]`);
    });
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:password|secret|token|api[_-]?key|credential)/iu.test(key))
      throw new Error(`RAW_SECRET_FIELD_FORBIDDEN:${path}.${key}`);
    assertNoRawSecretFields(child, `${path}.${key}`);
  }
}
