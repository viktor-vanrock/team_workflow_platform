import { AuthorizedProjectQueryToken, type ProjectScope } from "@awp/platform-core";

export interface ScopedWorkEnvelope<TPayload = unknown> extends ProjectScope {
  readonly workId: string;
  readonly permission: string;
  readonly classificationRank: number;
  readonly payloadHash: `sha256:${string}`;
  readonly payload?: TPayload;
}

export function projectScopedCacheKey(scope: ProjectScope, namespace: string, key: string): string {
  if (!scope.workspaceId || !scope.projectId || !namespace || !key)
    throw new Error("PROJECT_SCOPED_KEY_INVALID");
  return `${namespace}:${scope.workspaceId}:${scope.projectId}:${key}`;
}

export function createScopedWorkEnvelope<TPayload = unknown>(
  input: ScopedWorkEnvelope<TPayload>,
): Readonly<ScopedWorkEnvelope<TPayload>> {
  if (!input.workId || !input.permission || !/^sha256:[a-f0-9]{64}$/u.test(input.payloadHash))
    throw new Error("SCOPED_WORK_ENVELOPE_INVALID");
  return Object.freeze({ ...input });
}

export async function executeScopedWork<TResult>(
  envelope: ScopedWorkEnvelope,
  reauthorize: () => Promise<AuthorizedProjectQueryToken>,
  effect: () => Promise<TResult>,
): Promise<TResult> {
  const token = await reauthorize();
  if (
    token.workspaceId !== envelope.workspaceId ||
    token.permission !== envelope.permission ||
    !token.allows(envelope.projectId, envelope.classificationRank, "EFFECT")
  ) {
    throw new Error("SCOPED_WORK_AUTHORIZATION_REVOKED");
  }
  return effect();
}

export class MutableProjectAuthorizationDirectory {
  readonly #active: Set<string>;
  readonly #input: Readonly<{
    workspaceId: string;
    principalId: string;
    permission: string;
    issuedAt: string | Date;
  }>;

  constructor(
    input: Readonly<{
      workspaceId: string;
      principalId: string;
      permission: string;
      projectIds: readonly string[];
      issuedAt: string | Date;
    }>,
  ) {
    this.#active = new Set(input.projectIds);
    this.#input = input;
  }

  revoke(projectId: string): void {
    this.#active.delete(projectId);
  }
  grant(projectId: string): void {
    this.#active.add(projectId);
  }

  issue(): AuthorizedProjectQueryToken {
    return AuthorizedProjectQueryToken.issue({
      ...this.#input,
      projects: [...this.#active].map((projectId) => ({
        projectId,
        classificationCeilingRank: Number.MAX_SAFE_INTEGER,
        operationalState: "ACTIVE" as const,
        entitlementRef: { id: `entitlement:${projectId}`, version: 1 },
      })),
    });
  }
}
