import { AsyncLocalStorage } from "node:async_hooks";

import { Injectable } from "@nestjs/common";

import type { ResourceScope, WorkspaceContext } from "@awp/platform-core";

const forbiddenAuthoritativeFields = new Set([
  "actor",
  "actorId",
  "principalId",
  "role",
  "roles",
  "entitlement",
  "entitlements",
  "authorizationBasis",
  "workspaceId",
  "projectId",
]);

const targetPrincipalHandlers = new WeakSet<object>();
/** Marks a trusted route whose principalId is the command target, never its actor. */
export function TargetPrincipalCommand(): MethodDecorator {
  return (_target, _key, descriptor) => {
    if (typeof descriptor.value === "function") targetPrincipalHandlers.add(descriptor.value);
  };
}
export function assertNoAuthoritativeClientFields(body: unknown, handler?: object): void {
  if (body === null || typeof body !== "object" || Array.isArray(body) || ArrayBuffer.isView(body))
    return;
  const supplied = Object.keys(body as Record<string, unknown>).filter(
    (key) =>
      forbiddenAuthoritativeFields.has(key) &&
      !(key === "principalId" && handler && targetPrincipalHandlers.has(handler)),
  );
  if (supplied.length > 0)
    throw new Error(
      `Client-supplied authoritative fields are forbidden: ${supplied.sort().join(", ")}`,
    );
}

export interface AuthoritativeScopeResolver<TRequest = unknown> {
  resolve(request: TRequest, principalId: string): Promise<ResourceScope>;
}

@Injectable()
export class WorkspaceContextStore {
  readonly #storage = new AsyncLocalStorage<WorkspaceContext>();
  run<T>(context: WorkspaceContext, callback: () => T): T {
    return this.#storage.run(context, callback);
  }
  enter(context: WorkspaceContext): void {
    this.#storage.enterWith(context);
  }
  current(): WorkspaceContext {
    const value = this.#storage.getStore();
    if (!value) throw new Error("WorkspaceContext is unavailable outside an authenticated request");
    return value;
  }
}
