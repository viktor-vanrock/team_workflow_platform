export type QueueOperation =
  | "queue.project-lane.read"
  | "queue.entry.read"
  | "queue.portfolio.read"
  | "queue.policy.read"
  | "queue.calendar.read"
  | "queue.capacity.read"
  | "queue.admission.read"
  | "queue.sla.read"
  | "queue.calendar.publish"
  | "queue.policy.publish"
  | "queue.service-class.set"
  | "queue.order.move"
  | "queue.wip-override.request"
  | "queue.control.approve"
  | "queue.control.reject"
  | "queue.control.consume"
  | "queue.manual-session.start"
  | "queue.manual-session.resume"
  | "queue.automated-session.launch"
  | "queue.project.invalidate"
  | "queue.project.rebuild"
  | "queue.sla.reconcile"
  | "queue.capacity.reconcile";

export type QueueAuthorizationScope =
  "PROJECT" | "AUTHORIZED_PORTFOLIO" | "WORKSPACE" | "INTERNAL_PROJECT";
export type QueueClassificationRule =
  | "PROJECT_RESOURCE"
  | "AUTHORIZED_PROJECT_SET"
  | "AUTHORIZATION_NEUTRAL_POLICY_VIEW"
  | "AUTHORIZED_POLICY_FACET"
  | "INTERNAL_ONLY";

export interface QueueOperationContract {
  readonly identity:
    | "queue.project-lane.read@1.0.0"
    | "queue.portfolio.read@1.0.0"
    | "queue.policy.read@1.0.0"
    | "queue.capacity.read@1.0.0"
    | "queue.sla.read@1.0.0"
    | "queue.policy.publish@1.0.0"
    | "queue.control.request@1.0.0"
    | "queue.control.decide@1.0.0"
    | "queue.work-admit@1.0.0"
    | "queue.projection-maintain@1.0.0";
  readonly operation: QueueOperation;
  readonly permission: string;
  readonly trustedContext: readonly string[];
  readonly callerKind: "HUMAN" | "SERVICE";
  readonly scope: QueueAuthorizationScope;
  readonly classificationRule: QueueClassificationRule;
}

const contract = (
  identity: QueueOperationContract["identity"],
  operation: QueueOperation,
  permission: string,
  trustedContext: readonly string[],
  callerKind: QueueOperationContract["callerKind"],
  scope: QueueAuthorizationScope,
  classificationRule: QueueClassificationRule,
): QueueOperationContract =>
  Object.freeze({
    identity,
    operation,
    permission,
    trustedContext: Object.freeze([...trustedContext]),
    callerKind,
    scope,
    classificationRule,
  });

const projectReadContext = Object.freeze([
  "principal",
  "activeWorkspaceMembership",
  "projectEntitlement",
  "authorizedProjectSetHash",
  "queryHash",
  "comparatorRef",
  "authorizedProjectionGeneration",
]);
const portfolioReadContext = Object.freeze([
  "principal",
  "activeWorkspaceMembership",
  "authorizedProjectSet",
  "authorizedProjectSetHash",
  "queryHash",
  "comparatorRef",
  "authorizedProjectionGeneration",
]);
const policyReadContext = Object.freeze([
  "activeWorkspaceMembership",
  "authorizationNeutralPolicyViewRef",
  "businessCalendarRef",
]);
const capacityReadContext = Object.freeze([
  "activeWorkspaceMembership",
  "authorizedProjectSetHash",
  "authorizedPolicyFacetRef",
  "capacityProjectionRef",
]);
const slaReadContext = Object.freeze([
  "principal",
  "activeWorkspaceMembership",
  "projectEntitlement",
  "workItemRef",
  "clockGoal",
  "serverAsOf",
]);
const policyPublishContext = Object.freeze([
  "activeWorkspaceMembership",
  "draftRef",
  "draftHash",
  "ownerRef",
  "baselineEvidenceRef",
  "expectedHeaderVersion",
  "requestKey",
]);
const controlRequestContext = Object.freeze([
  "principal",
  "activeWorkspaceMembership",
  "projectEntitlement",
  "subjectRef",
  "policyFacetRef",
  "controlVersion",
  "capacityWitness",
  "authorizedProjectSetHash",
  "requestKey",
]);
const controlDecisionContext = Object.freeze([
  "principal",
  "activeWorkspaceMembership",
  "approvalSubjectV2Ref",
  "publicIntentHash",
  "privateActionHash",
  "currentAuthorizationBasis",
  "expiry",
]);
const workAdmissionContext = Object.freeze([
  "principal",
  "activeWorkspaceMembership",
  "projectEntitlement",
  "qaMutationAuthorization",
  "workItemRef",
  "sessionRef",
  "policyFacetRef",
  "lockedCapacityHead",
]);
const maintenanceContext = Object.freeze([
  "allowlistedConsumerIdentity",
  "boundedWorkspaceProjectCursor",
  "immutableSourceRefs",
]);

export const queueOperationCatalog: readonly QueueOperationContract[] = Object.freeze([
  contract(
    "queue.project-lane.read@1.0.0",
    "queue.project-lane.read",
    "queue.project.read",
    projectReadContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.project-lane.read@1.0.0",
    "queue.entry.read",
    "queue.project.read",
    projectReadContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.portfolio.read@1.0.0",
    "queue.portfolio.read",
    "queue.portfolio.read",
    portfolioReadContext,
    "HUMAN",
    "AUTHORIZED_PORTFOLIO",
    "AUTHORIZED_PROJECT_SET",
  ),
  contract(
    "queue.policy.read@1.0.0",
    "queue.policy.read",
    "queue.policy.read",
    policyReadContext,
    "HUMAN",
    "WORKSPACE",
    "AUTHORIZATION_NEUTRAL_POLICY_VIEW",
  ),
  contract(
    "queue.policy.read@1.0.0",
    "queue.calendar.read",
    "queue.calendar.read",
    policyReadContext,
    "HUMAN",
    "WORKSPACE",
    "AUTHORIZATION_NEUTRAL_POLICY_VIEW",
  ),
  contract(
    "queue.capacity.read@1.0.0",
    "queue.capacity.read",
    "queue.capacity.read",
    capacityReadContext,
    "HUMAN",
    "AUTHORIZED_PORTFOLIO",
    "AUTHORIZED_POLICY_FACET",
  ),
  contract(
    "queue.capacity.read@1.0.0",
    "queue.admission.read",
    "queue.capacity.read",
    capacityReadContext,
    "HUMAN",
    "AUTHORIZED_PORTFOLIO",
    "AUTHORIZED_POLICY_FACET",
  ),
  contract(
    "queue.sla.read@1.0.0",
    "queue.sla.read",
    "queue.sla.read",
    slaReadContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.policy.publish@1.0.0",
    "queue.calendar.publish",
    "queue.calendar.publish",
    policyPublishContext,
    "HUMAN",
    "WORKSPACE",
    "INTERNAL_ONLY",
  ),
  contract(
    "queue.policy.publish@1.0.0",
    "queue.policy.publish",
    "queue.policy.publish",
    policyPublishContext,
    "HUMAN",
    "WORKSPACE",
    "INTERNAL_ONLY",
  ),
  contract(
    "queue.control.request@1.0.0",
    "queue.service-class.set",
    "queue.control.request",
    controlRequestContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.control.request@1.0.0",
    "queue.order.move",
    "queue.order.move",
    controlRequestContext,
    "HUMAN",
    "AUTHORIZED_PORTFOLIO",
    "AUTHORIZED_PROJECT_SET",
  ),
  contract(
    "queue.control.request@1.0.0",
    "queue.wip-override.request",
    "queue.control.request",
    controlRequestContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.control.decide@1.0.0",
    "queue.control.approve",
    "queue.control.decide",
    controlDecisionContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.control.decide@1.0.0",
    "queue.control.reject",
    "queue.control.decide",
    controlDecisionContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.control.decide@1.0.0",
    "queue.control.consume",
    "queue.control.decide",
    controlDecisionContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.work-admit@1.0.0",
    "queue.manual-session.start",
    "qa.session.execute",
    workAdmissionContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.work-admit@1.0.0",
    "queue.manual-session.resume",
    "qa.session.execute",
    workAdmissionContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.work-admit@1.0.0",
    "queue.automated-session.launch",
    "qa.session.execute",
    workAdmissionContext,
    "HUMAN",
    "PROJECT",
    "PROJECT_RESOURCE",
  ),
  contract(
    "queue.projection-maintain@1.0.0",
    "queue.project.invalidate",
    "queue.projection.maintain",
    maintenanceContext,
    "SERVICE",
    "INTERNAL_PROJECT",
    "INTERNAL_ONLY",
  ),
  contract(
    "queue.projection-maintain@1.0.0",
    "queue.project.rebuild",
    "queue.projection.maintain",
    maintenanceContext,
    "SERVICE",
    "INTERNAL_PROJECT",
    "INTERNAL_ONLY",
  ),
  contract(
    "queue.projection-maintain@1.0.0",
    "queue.sla.reconcile",
    "queue.projection.maintain",
    maintenanceContext,
    "SERVICE",
    "INTERNAL_PROJECT",
    "INTERNAL_ONLY",
  ),
  contract(
    "queue.projection-maintain@1.0.0",
    "queue.capacity.reconcile",
    "queue.projection.maintain",
    maintenanceContext,
    "SERVICE",
    "INTERNAL_PROJECT",
    "INTERNAL_ONLY",
  ),
]);

export type QueueAccessAxisReason =
  "ALLOWED" | "NOT_AUTHORIZED" | "CAPABILITY_UNAVAILABLE" | "ACTOR_UNAVAILABLE";

export function evaluateQueueAccessAxes(
  input: Readonly<{
    authorized: boolean;
    capable: boolean;
    available: boolean;
  }>,
): Readonly<{ allowed: boolean; reason: QueueAccessAxisReason }> {
  if (!input.authorized) return Object.freeze({ allowed: false, reason: "NOT_AUTHORIZED" });
  if (!input.capable) return Object.freeze({ allowed: false, reason: "CAPABILITY_UNAVAILABLE" });
  if (!input.available) return Object.freeze({ allowed: false, reason: "ACTOR_UNAVAILABLE" });
  return Object.freeze({ allowed: true, reason: "ALLOWED" });
}

export function queueOperationContract(operation: QueueOperation): QueueOperationContract {
  const found = queueOperationCatalog.find((candidate) => candidate.operation === operation);
  if (!found) throw new Error(`QUEUE_OPERATION_UNCATALOGED:${operation}`);
  return found;
}
