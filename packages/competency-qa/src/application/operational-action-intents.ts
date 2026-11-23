export type QaOperationalActionIntent = Readonly<{
  operation:
    "request.transition" | "request.assign" | "request.set-priority" | "request.set-due-date";
  workItemId: string;
  payload: Readonly<Record<string, unknown>>;
  approvalRequired: true;
}>;
function intent(
  operation: QaOperationalActionIntent["operation"],
  workItemId: string,
  payload: Readonly<Record<string, unknown>>,
): QaOperationalActionIntent {
  if (!workItemId) throw new Error("QA_OPERATIONAL_WORK_ITEM_REQUIRED");
  return Object.freeze({
    operation,
    workItemId,
    payload: Object.freeze({ ...payload }),
    approvalRequired: true,
  });
}
export const qaTransitionIntent = (workItemId: string, toStatusKey: string) =>
  intent("request.transition", workItemId, { transition: { toStatusKey } });
export const qaAssignmentIntent = (workItemId: string, canonicalPrincipalId: string | null) =>
  intent("request.assign", workItemId, {
    assignment: canonicalPrincipalId ? { canonicalPrincipalId } : { unassign: true },
  });
export const qaPriorityIntent = (workItemId: string, normalizedKey: string) =>
  intent("request.set-priority", workItemId, { priority: { normalizedKey } });
export const qaDueDateIntent = (workItemId: string, value: string | null) =>
  intent("request.set-due-date", workItemId, { dueDate: value ? { value } : { clear: true } });
