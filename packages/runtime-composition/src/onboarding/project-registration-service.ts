import {
  createOnboardingRevision,
  createProjectEventEnvelope,
  createProjectRegistryRevision,
  type HumanActorSnapshot,
  onboardingContentHash,
  type ProjectOnboardingRevision,
  type ProjectRegistryRevision,
  type ProjectScope,
} from "@awp/platform-core";
import type {
  ProjectRegistrationAudit,
  ProjectRegistrationPersistenceInput,
} from "@awp/platform-persistence-typeorm";

interface ProjectRegistrationRepositoryPort {
  registerProject(input: ProjectRegistrationPersistenceInput): Promise<void>;
}

export interface ProjectRegistrationIds {
  now(): string;
  next(kind: "registry" | "onboarding" | "audit" | "event"): string;
}

export interface RegisterProjectInput extends ProjectScope {
  readonly idempotencyKey: string;
  readonly key: string;
  readonly name: string;
  readonly ownerIds: readonly string[];
  readonly criticalityKey: string;
  readonly dataClassificationKey: string;
  readonly starterEntitlementSetHash: `sha256:${string}`;
  readonly actor: HumanActorSnapshot;
  readonly reason: string;
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface ProjectRegistrationResult {
  readonly projectId: string;
  readonly registry: ProjectRegistryRevision;
  readonly onboarding: ProjectOnboardingRevision;
  readonly audit: ProjectRegistrationAudit;
  readonly outbox: ProjectRegistrationPersistenceInput["outbox"];
  readonly replayed: boolean;
}

export class ProjectRegistrationService {
  readonly #idempotency = new Map<
    string,
    Readonly<{ requestHash: string; result: ProjectRegistrationResult }>
  >();

  constructor(
    private readonly repository: ProjectRegistrationRepositoryPort,
    private readonly runtime: ProjectRegistrationIds,
  ) {}

  async register(input: RegisterProjectInput): Promise<ProjectRegistrationResult> {
    if (!input.idempotencyKey) throw new Error("PROJECT_REGISTRATION_IDEMPOTENCY_KEY_REQUIRED");
    const key = `${input.workspaceId}:${input.actor.principalId}:${input.idempotencyKey}`;
    const requestHash = onboardingContentHash(input as never);
    const replay = this.#idempotency.get(key);
    if (replay) {
      if (replay.requestHash !== requestHash)
        throw new Error("PROJECT_REGISTRATION_IDEMPOTENCY_CONFLICT");
      return Object.freeze({ ...replay.result, replayed: true });
    }

    const createdAt = this.runtime.now();
    const registry = createProjectRegistryRevision({
      revisionId: this.runtime.next("registry"),
      version: 1,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      key: input.key,
      name: input.name,
      ownerIds: input.ownerIds,
      criticalityKey: input.criticalityKey,
      dataClassificationKey: input.dataClassificationKey,
      verificationStatus: "CURRENT",
      reason: input.reason,
      createdBy: input.actor,
      createdAt,
    });
    const onboarding = createOnboardingRevision({
      revisionId: this.runtime.next("onboarding"),
      onboardingId: input.projectId,
      version: 1,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      stage: "DRAFT",
      qaCapabilityMode: "MANUAL_ONLY",
      operationalState: "ACTIVE",
      intendedCapabilityMode: "MANUAL_ONLY",
      projectRegistryRef: {
        id: registry.revisionId,
        version: registry.version,
        contentHash: registry.contentHash,
      },
      starterEntitlementSetHash: input.starterEntitlementSetHash,
      gateResultRefs: [],
      ownerSetHash: onboardingContentHash(registry.ownerIds as never),
      reasonCode: "PROJECT_REGISTERED",
      reason: input.reason,
      actor: input.actor,
      correlationId: input.correlationId,
      ...(input.causationId ? { causationId: input.causationId } : {}),
      createdAt,
    });
    const causationId = input.causationId ?? input.correlationId;
    const audit: ProjectRegistrationAudit = Object.freeze({
      auditId: this.runtime.next("audit"),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: "PROJECT_REGISTERED",
      outcome: "SUCCEEDED",
      before: null,
      after: registry,
      actor: input.actor,
      occurredAt: createdAt,
      reasonCode: "PROJECT_REGISTERED",
      correlationId: input.correlationId,
      causationId,
      classificationKey: input.dataClassificationKey,
    });
    const outbox = createProjectEventEnvelope({
      eventId: this.runtime.next("event"),
      eventType: "PROJECT_REGISTERED",
      scope: input,
      subjectRef: {
        id: registry.revisionId,
        version: registry.version,
        contentHash: registry.contentHash,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      },
      reasonCode: "PROJECT_REGISTERED",
      relatedRefs: [
        {
          id: onboarding.revisionId,
          version: onboarding.version,
          contentHash: onboarding.contentHash,
        },
      ],
      actor: input.actor,
      occurredAt: createdAt,
      correlationId: input.correlationId,
      causationId,
    });
    await this.repository.registerProject({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      key: input.key,
      name: input.name,
      classificationKey: input.dataClassificationKey,
      registry,
      onboarding,
      audit,
      outbox,
    });
    const result = Object.freeze({
      projectId: input.projectId,
      registry,
      onboarding,
      audit,
      outbox,
      replayed: false,
    });
    this.#idempotency.set(key, Object.freeze({ requestHash, result }));
    return result;
  }
}
