import type { QaHumanActor } from "@awp/competency-qa/node";

import type { QueueApprovalAuthorization } from "./approval-api.ts";

/** Opaque HTTP request; only the injected identity adapter interprets it. */
export type QueueRuntimeRequest = object;
export interface QueueHttpAuthority {
  project(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ): Promise<QueueApprovalAuthorization>;
  workspace(
    request: QueueRuntimeRequest,
    workspaceId: string,
    permission: string,
  ): Promise<QaHumanActor>;
  portfolio(
    request: QueueRuntimeRequest,
    workspaceId: string,
    permissions: readonly string[],
  ): Promise<Readonly<{ principalId: string; projectIds: readonly string[] }>>;
}
