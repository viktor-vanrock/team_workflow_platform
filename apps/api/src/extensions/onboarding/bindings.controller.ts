import { bindingLifecycleAction } from "./bindings.application.ts";
import { etag, exact, object, text } from "./durable-http.ts";

export type { BindingLifecycleAction } from "./bindings.application.ts";
export { bindingLifecycleAction } from "./bindings.application.ts";

export function bindingApprovedCommand(body: unknown, match: string | undefined) {
  const value = object(body, ["candidateRef", "approvalRef"]);
  return {
    expectedVersion: etag(match),
    candidateRef: exact(value.candidateRef),
    approvalRef: exact(value.approvalRef),
  };
}
export function bindingCandidateCommand(body: unknown, match: string | undefined) {
  const value = object(body, ["operation", "bindingRef", "reason"]);
  return {
    expectedVersion: etag(match),
    operation: bindingLifecycleAction(value.operation),
    bindingRef: exact(value.bindingRef),
    reason: text(value.reason),
  };
}
