import type { DataSource } from "typeorm";

import type { OperationalAuthorityApiPort } from "@awp/platform-runtime-nest";

import {
  authorizeQaApi,
  type QaApiAuthorization,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

type Input<K extends keyof OperationalAuthorityApiPort> = Omit<
  Parameters<OperationalAuthorityApiPort[K]>[0],
  "request"
>;
type Authorized<K extends keyof OperationalAuthorityApiPort> = Input<K> & {
  readonly authorizations: readonly QaApiAuthorization[];
};
export interface OperationalAuthorityHandlers {
  projection(input: Authorized<"projection">): Promise<unknown>;
  conflicts(input: Authorized<"conflicts">): Promise<unknown>;
  importDiagnostics(input: Authorized<"importDiagnostics">): Promise<unknown>;
  reconciliation(input: Authorized<"reconciliation">, lane: string): Promise<unknown>;
  prepareAction(input: Authorized<"prepareAction">): Promise<unknown>;
  decideApproval(input: Authorized<"decideApproval">): Promise<unknown>;
}

/** Runs before any read, reconciliation enqueue or operational command preparation. */
export function createOperationalAuthorityHttpApi(
  source: DataSource,
  handlers: OperationalAuthorityHandlers,
): OperationalAuthorityApiPort {
  async function authorize<T extends { request: object; workspaceId: string; projectId: string }>(
    input: T,
    permissions: readonly string[],
  ): Promise<Omit<T, "request"> & { authorizations: readonly QaApiAuthorization[] }> {
    const { request, ...scopeAndPayload } = input;
    const authorizations: QaApiAuthorization[] = [];
    for (const permission of permissions) {
      const authorization = await authorizeQaApi(
        source,
        request as QaSessionRequest,
        input.workspaceId,
        input.projectId,
        permission,
      );
      if (
        authorizations.length &&
        authorizations[0]!.actor.principalId !== authorization.actor.principalId
      )
        throw new Error("OPERATIONAL_AUTHORITY_CHANGED");
      authorizations.push(authorization);
    }
    // The HTTP request is deliberately excluded from persisted action inputs.
    return { ...scopeAndPayload, authorizations: Object.freeze(authorizations) };
  }
  return {
    projection: async (input) => handlers.projection(await authorize(input, ["work-item.read"])),
    conflicts: async (input) => handlers.conflicts(await authorize(input, ["work-item.read"])),
    importDiagnostics: async (input) =>
      handlers.importDiagnostics(await authorize(input, ["work-item.read"])),
    reconciliation: async (input, lane) =>
      handlers.reconciliation(await authorize(input, ["integration.validate"]), lane),
    prepareAction: async (input) =>
      handlers.prepareAction(await authorize(input, ["command.execute", "integration.use"])),
    decideApproval: async (input) =>
      handlers.decideApproval(await authorize(input, ["approval.decide"])),
  };
}
