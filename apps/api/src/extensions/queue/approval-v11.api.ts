import { createRuntimeApprovalsV11Api, type QueueHttpAuthority } from "@awp/runtime-composition";

type ApprovalDataSource = Parameters<typeof createRuntimeApprovalsV11Api>[0];
export function createApprovalsV11Api(source: ApprovalDataSource, authority: QueueHttpAuthority) {
  return createRuntimeApprovalsV11Api(source, authority);
}
