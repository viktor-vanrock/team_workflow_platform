import {
  createProjectEventEnvelope,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  type ProjectEventEnvelope,
  type ProjectEventType,
  type ProjectScope,
} from "@awp/platform-core";

export type OnboardingEventKind =
  | "PROJECT_REGISTRY_CHANGED"
  | "PROJECT_ENTITLEMENT_CHANGED"
  | "PROJECT_GATE_EVALUATED"
  | "PROJECT_BINDING_PUBLISHED"
  | "PROJECT_BINDING_RETIRED"
  | "PROJECT_CAPABILITY_MODE_CHANGED"
  | "PROJECT_ONBOARDING_STAGE_CHANGED"
  | "TEST_ACCOUNT_LEASE_CHANGED";

const coreType: Readonly<Record<OnboardingEventKind, ProjectEventType>> = Object.freeze({
  PROJECT_REGISTRY_CHANGED: "PROJECT_REGISTERED",
  PROJECT_ENTITLEMENT_CHANGED: "PROJECT_ENTITLEMENTS_CHANGED",
  PROJECT_GATE_EVALUATED: "PROJECT_ONBOARDING_CHANGED",
  PROJECT_BINDING_PUBLISHED: "PROJECT_BINDING_CHANGED",
  PROJECT_BINDING_RETIRED: "PROJECT_BINDING_CHANGED",
  PROJECT_CAPABILITY_MODE_CHANGED: "PROJECT_ONBOARDING_CHANGED",
  PROJECT_ONBOARDING_STAGE_CHANGED: "PROJECT_ONBOARDING_CHANGED",
  TEST_ACCOUNT_LEASE_CHANGED: "PROJECT_ONBOARDING_CHANGED",
});

export function createOnboardingEvent(
  input: ProjectScope &
    Readonly<{
      eventId: string;
      kind: OnboardingEventKind;
      subjectRef: ExactRevisionRef;
      relatedRefs?: readonly ExactRevisionRef[];
      reasonCode: string;
      actor:
        HumanActorSnapshot | Readonly<{ kind: "SERVICE"; principalId: string; serviceKey: string }>;
      occurredAt: string;
      correlationId: string;
      causationId: string;
    }>,
): ProjectEventEnvelope {
  return createProjectEventEnvelope({
    eventId: input.eventId,
    eventType: coreType[input.kind],
    scope: input,
    subjectRef: input.subjectRef,
    reasonCode: `${input.kind}:${input.reasonCode}`,
    relatedRefs: input.relatedRefs ?? [],
    actor: input.actor,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    causationId: input.causationId,
  });
}

export function createOnboardingTransitionEvent(
  input: ProjectScope &
    Readonly<{
      eventId: string;
      kind:
        | "PROJECT_BINDING_RETIRED"
        | "PROJECT_CAPABILITY_MODE_CHANGED"
        | "PROJECT_ONBOARDING_STAGE_CHANGED";
      predecessorRef: ExactRevisionRef;
      resultRef: ExactRevisionRef;
      prerequisiteRefs?: readonly ExactRevisionRef[];
      reasonCode: string;
      actor:
        HumanActorSnapshot | Readonly<{ kind: "SERVICE"; principalId: string; serviceKey: string }>;
      occurredAt: string;
      correlationId: string;
      causationId: string;
    }>,
): ProjectEventEnvelope {
  return createOnboardingEvent({
    ...input,
    subjectRef: input.resultRef,
    relatedRefs: [input.predecessorRef, ...(input.prerequisiteRefs ?? [])],
  });
}
