import {
  type BindingFunctionalAcceptance,
  consumeProjectActionApproval,
  createProjectActionCandidate,
  type ExactRevisionRef,
  executeProjectBindingPublication,
  type HumanActorSnapshot,
  isSystemAdministratorRole,
  onboardingContentHash,
  type ProjectActionApproval,
  type ProjectActionCandidate,
  type ProjectScope,
} from "@awp/platform-core";

export interface PublishedBindingRecord extends ProjectScope {
  readonly ref: ExactRevisionRef;
  readonly state: "DRAFT" | "PUBLISHED" | "RETIRED";
  readonly resourceVersion: number;
  readonly semanticContent?: unknown;
  readonly clonedFromRef?: ExactRevisionRef;
}

export class InMemoryBindingLifecycleStore {
  readonly #actions = new Map<string, ProjectActionCandidate>();
  readonly #consumed = new Set<string>();
  readonly #bindings = new Map<string, PublishedBindingRecord>();
  readonly #current = new Map<string, string>();
  readonly #audit: unknown[] = [];
  readonly #outbox: unknown[] = [];
  #onboardingVersion: number;

  constructor(options: Readonly<{ onboardingVersion?: number }> = {}) {
    this.#onboardingVersion = options.onboardingVersion ?? 2;
  }

  #bindingKey(binding: Pick<PublishedBindingRecord, "workspaceId" | "projectId" | "ref">): string {
    return `${binding.workspaceId}:${binding.projectId}:${binding.ref.id}:${binding.ref.version}`;
  }

  seedPublished(binding: PublishedBindingRecord): void {
    const key = this.#bindingKey(binding);
    if (this.#bindings.has(key)) throw new Error("BINDING_VERSION_IMMUTABLE");
    this.#bindings.set(key, structuredClone(binding));
    if (binding.state === "PUBLISHED")
      this.#current.set(`${binding.workspaceId}:${binding.projectId}`, key);
  }

  current(scope: ProjectScope): PublishedBindingRecord | undefined {
    const key = this.#current.get(`${scope.workspaceId}:${scope.projectId}`);
    return key ? structuredClone(this.#bindings.get(key)) : undefined;
  }

  history(scope: ProjectScope): readonly PublishedBindingRecord[] {
    return structuredClone(
      [...this.#bindings.values()]
        .filter(
          (binding) =>
            binding.workspaceId === scope.workspaceId && binding.projectId === scope.projectId,
        )
        .sort((left, right) => left.ref.version - right.ref.version),
    );
  }

  saveDraft(binding: PublishedBindingRecord): void {
    if (binding.state !== "DRAFT") throw new Error("BINDING_DRAFT_REQUIRED");
    const key = this.#bindingKey(binding);
    if (this.#bindings.has(key)) throw new Error("BINDING_VERSION_IMMUTABLE");
    this.#bindings.set(key, structuredClone(binding));
  }

  saveAction(action: ProjectActionCandidate): void {
    if (this.#actions.has(action.actionId)) throw new Error("PROJECT_ACTION_IMMUTABLE");
    this.#actions.set(action.actionId, structuredClone(action));
  }

  action(actionId: string): ProjectActionCandidate | undefined {
    return structuredClone(this.#actions.get(actionId));
  }
  consumed(actionId: string): boolean {
    return this.#consumed.has(actionId);
  }

  publish(
    action: ProjectActionCandidate,
    approval: ProjectActionApproval & Readonly<{ consumedAt: string }>,
  ): Readonly<{ binding: PublishedBindingRecord; retired?: PublishedBindingRecord }> {
    if (this.#consumed.has(action.actionId)) throw new Error("APPROVAL_ALREADY_CONSUMED");
    if (action.expectedOnboardingVersion !== this.#onboardingVersion)
      throw new Error("ONBOARDING_VERSION_CONFLICT");
    const scopeKey = `${action.workspaceId}:${action.projectId}`;
    const currentKey = this.#current.get(scopeKey);
    let retired: PublishedBindingRecord | undefined;
    if (currentKey) {
      const previous = this.#bindings.get(currentKey)!;
      retired = Object.freeze({
        ...previous,
        state: "RETIRED",
        resourceVersion: previous.resourceVersion + 1,
      });
      this.#bindings.set(currentKey, retired);
    }
    const existingCandidate = this.#bindings.get(
      `${scopeKey}:${action.targetRef.id}:${action.targetRef.version}`,
    );
    const binding = Object.freeze({
      workspaceId: action.workspaceId,
      projectId: action.projectId,
      ref: action.targetRef,
      state: "PUBLISHED" as const,
      resourceVersion: (existingCandidate?.resourceVersion ?? 0) + 1,
      ...(existingCandidate?.semanticContent === undefined
        ? {}
        : { semanticContent: existingCandidate.semanticContent }),
      ...(existingCandidate?.clonedFromRef === undefined
        ? {}
        : { clonedFromRef: existingCandidate.clonedFromRef }),
    });
    const bindingKey = `${scopeKey}:${binding.ref.id}:${binding.ref.version}`;
    this.#bindings.set(bindingKey, binding);
    this.#current.set(scopeKey, bindingKey);
    this.#consumed.add(action.actionId);
    this.#onboardingVersion += 1;
    this.#audit.push(
      structuredClone({
        action: "BINDING_PUBLISHED",
        workspaceId: action.workspaceId,
        projectId: action.projectId,
        before: retired ?? null,
        after: binding,
        initiator: action.initiator,
        approver: approval.approver,
        occurredAt: approval.consumedAt,
      }),
    );
    this.#outbox.push(
      structuredClone({
        type: "PROJECT_BINDING_CHANGED",
        partitionKey: scopeKey,
        bindingRef: binding.ref,
        previousBindingRef: retired?.ref,
        occurredAt: approval.consumedAt,
      }),
    );
    return Object.freeze({ binding, ...(retired ? { retired } : {}) });
  }

  retire(
    action: ProjectActionCandidate,
    approval: ProjectActionApproval & Readonly<{ consumedAt: string }>,
  ): PublishedBindingRecord {
    if (this.#consumed.has(action.actionId)) throw new Error("APPROVAL_ALREADY_CONSUMED");
    if (action.expectedOnboardingVersion !== this.#onboardingVersion)
      throw new Error("ONBOARDING_VERSION_CONFLICT");
    const scope = { workspaceId: action.workspaceId, projectId: action.projectId };
    const current = this.current(scope);
    if (
      !current ||
      current.ref.id !== action.targetRef.id ||
      current.ref.version !== action.targetRef.version ||
      current.ref.contentHash !== action.targetRef.contentHash
    )
      throw new Error("BINDING_RETIRE_TARGET_NOT_CURRENT");
    const retired = Object.freeze({
      ...current,
      state: "RETIRED" as const,
      resourceVersion: current.resourceVersion + 1,
    });
    this.#bindings.set(this.#bindingKey(retired), retired);
    this.#current.delete(`${action.workspaceId}:${action.projectId}`);
    this.#consumed.add(action.actionId);
    this.#onboardingVersion += 1;
    this.#audit.push(
      structuredClone({
        action: "BINDING_RETIRED",
        workspaceId: action.workspaceId,
        projectId: action.projectId,
        before: current,
        after: retired,
        initiator: action.initiator,
        approver: approval.approver,
        occurredAt: approval.consumedAt,
      }),
    );
    this.#outbox.push(
      structuredClone({
        type: "PROJECT_BINDING_CHANGED",
        partitionKey: `${action.workspaceId}:${action.projectId}`,
        bindingRef: retired.ref,
        occurredAt: approval.consumedAt,
      }),
    );
    return retired;
  }

  audit(): readonly unknown[] {
    return structuredClone(this.#audit);
  }
  outbox(): readonly unknown[] {
    return structuredClone(this.#outbox);
  }
}

export interface RequestBindingPublicationInput extends ProjectScope {
  readonly actionId: string;
  readonly bindingRef: ExactRevisionRef;
  readonly validationReportRef: ExactRevisionRef;
  readonly acceptance: BindingFunctionalAcceptance;
  readonly expectedOnboardingVersion: number;
  readonly initiator: HumanActorSnapshot;
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface RequestBindingRetirementInput extends ProjectScope {
  readonly actionId: string;
  readonly bindingRef: ExactRevisionRef;
  readonly expectedOnboardingVersion: number;
  readonly initiator: HumanActorSnapshot;
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class BindingLifecycleService {
  constructor(private readonly store: InMemoryBindingLifecycleStore) {}

  async requestPublication(input: RequestBindingPublicationInput): Promise<ProjectActionCandidate> {
    if (!isSystemAdministratorRole(input.initiator.roleKey))
      throw new Error("BINDING_PUBLICATION_INITIATOR_UNAUTHORIZED");
    const acceptance = input.acceptance;
    if (
      acceptance.outcome !== "ACCEPTED" ||
      acceptance.workspaceId !== input.workspaceId ||
      acceptance.projectId !== input.projectId ||
      acceptance.bindingRef.id !== input.bindingRef.id ||
      acceptance.bindingRef.version !== input.bindingRef.version ||
      acceptance.bindingRef.contentHash !== input.bindingRef.contentHash ||
      acceptance.validationReportRef.id !== input.validationReportRef.id ||
      acceptance.validationReportRef.version !== input.validationReportRef.version ||
      acceptance.validationReportRef.contentHash !== input.validationReportRef.contentHash
    ) {
      throw new Error("BINDING_FUNCTIONAL_ACCEPTANCE_MISMATCH");
    }
    const action = createProjectActionCandidate({
      actionId: input.actionId,
      kind: "BINDING_PUBLISH",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      targetRef: input.bindingRef,
      expectedOnboardingVersion: input.expectedOnboardingVersion,
      prerequisiteRefs: [
        input.validationReportRef,
        {
          id: acceptance.acceptanceId,
          version: acceptance.version,
          contentHash: acceptance.contentHash,
        },
      ],
      initiator: input.initiator,
      reason: input.reason,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    });
    this.store.saveAction(action);
    return action;
  }

  async requestRetirement(input: RequestBindingRetirementInput): Promise<ProjectActionCandidate> {
    if (!isSystemAdministratorRole(input.initiator.roleKey))
      throw new Error("BINDING_RETIRE_INITIATOR_UNAUTHORIZED");
    const current = this.store.current(input);
    if (
      !current ||
      current.ref.id !== input.bindingRef.id ||
      current.ref.version !== input.bindingRef.version ||
      current.ref.contentHash !== input.bindingRef.contentHash
    )
      throw new Error("BINDING_RETIRE_TARGET_NOT_CURRENT");
    const action = createProjectActionCandidate({
      actionId: input.actionId,
      kind: "BINDING_RETIRE",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      targetRef: input.bindingRef,
      expectedOnboardingVersion: input.expectedOnboardingVersion,
      prerequisiteRefs: [],
      initiator: input.initiator,
      reason: input.reason,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    });
    this.store.saveAction(action);
    return action;
  }

  async publish(
    input: Readonly<{
      actionId: string;
      approval: ProjectActionApproval;
      approverCurrentlyAuthorized: boolean;
      now: string;
    }>,
  ) {
    const action = this.store.action(input.actionId);
    if (!action) throw new Error("PROJECT_ACTION_NOT_FOUND");
    if (this.store.consumed(action.actionId)) throw new Error("APPROVAL_ALREADY_CONSUMED");
    const approval = executeProjectBindingPublication(action, input.approval, input);
    const published = this.store.publish(action, approval);
    return Object.freeze({ ...published, action, approval });
  }

  async retire(
    input: Readonly<{
      actionId: string;
      approval: ProjectActionApproval;
      approverCurrentlyAuthorized: boolean;
      now: string;
    }>,
  ) {
    const action = this.store.action(input.actionId);
    if (!action) throw new Error("PROJECT_ACTION_NOT_FOUND");
    if (action.kind !== "BINDING_RETIRE") throw new Error("BINDING_RETIRE_ACTION_REQUIRED");
    if (
      !input.approverCurrentlyAuthorized ||
      !isSystemAdministratorRole(input.approval.approver.roleKey)
    )
      throw new Error("BINDING_RETIRE_OWNER_AUTHORIZATION_REQUIRED");
    if (this.store.consumed(action.actionId)) throw new Error("APPROVAL_ALREADY_CONSUMED");
    const approval = consumeProjectActionApproval(action, input.approval, input.now);
    return Object.freeze({ binding: this.store.retire(action, approval), action, approval });
  }

  async publishAcceptedForTest(
    input: ProjectScope &
      Readonly<{
        bindingRef: ExactRevisionRef;
        expectedOnboardingVersion: number;
        semanticContent: unknown;
        now: string;
      }>,
  ) {
    const action: ProjectActionCandidate = Object.freeze({
      actionId: `test-publication:${input.bindingRef.id}:${input.bindingRef.version}`,
      kind: "BINDING_PUBLISH",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      targetRef: input.bindingRef,
      expectedOnboardingVersion: input.expectedOnboardingVersion,
      prerequisiteRefs: [],
      initiator: Object.freeze({
        kind: "HUMAN",
        principalId: "test-initiator",
        roleKey: "system-administrator",
        authorizationBasisRef: input.bindingRef,
        authenticationContextRef: input.bindingRef,
      }),
      reason: "Test publication",
      createdAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + 60_000).toISOString(),
      contentHash: onboardingContentHash({
        bindingRef: input.bindingRef,
        expectedOnboardingVersion: input.expectedOnboardingVersion,
      } as never),
    });
    this.store.saveDraft({
      workspaceId: action.workspaceId,
      projectId: action.projectId,
      ref: input.bindingRef,
      state: "DRAFT",
      resourceVersion: 1,
      semanticContent: structuredClone(input.semanticContent),
    });
    return this.store.publish(
      action,
      Object.freeze({
        approvalId: `${action.actionId}:approval`,
        subjectKind: "PLATFORM_ACTION",
        actionKind: "BINDING_PUBLISH",
        actionId: action.actionId,
        targetHash: action.contentHash,
        initiatorPrincipalId: action.initiator.principalId,
        approver: Object.freeze({
          ...action.initiator,
          principalId: "test-owner",
          roleKey: "system-administrator",
        }),
        approvedAt: input.now,
        expiresAt: action.expiresAt,
        consumedAt: input.now,
      }),
    );
  }

  cloneHistoricalAsDraft(
    input: ProjectScope &
      Readonly<{
        historicalRef: ExactRevisionRef;
        actor: HumanActorSnapshot;
        createdAt: string;
        expectedNextVersion?: number;
      }>,
  ): PublishedBindingRecord {
    if (!isSystemAdministratorRole(input.actor.roleKey))
      throw new Error("BINDING_ROLLBACK_INITIATOR_UNAUTHORIZED");
    const historical = this.store
      .history(input)
      .find(
        ({ ref }) =>
          ref.id === input.historicalRef.id &&
          ref.version === input.historicalRef.version &&
          ref.contentHash === input.historicalRef.contentHash,
      );
    if (!historical || historical.state === "DRAFT" || historical.semanticContent === undefined)
      throw new Error("BINDING_ROLLBACK_SOURCE_INVALID");
    const version =
      Math.max(
        0,
        ...this.store
          .history(input)
          .filter(({ ref }) => ref.id === historical.ref.id)
          .map(({ ref }) => ref.version),
      ) + 1;
    if (input.expectedNextVersion !== undefined && input.expectedNextVersion !== version)
      throw new Error("BINDING_ROLLBACK_VERSION_CONFLICT");
    const semanticContent = structuredClone(historical.semanticContent);
    const draft = Object.freeze({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ref: Object.freeze({
        id: historical.ref.id,
        version,
        contentHash: onboardingContentHash(semanticContent as never),
      }),
      state: "DRAFT" as const,
      resourceVersion: 1,
      semanticContent,
      clonedFromRef: historical.ref,
    });
    this.store.saveDraft(draft);
    return draft;
  }
}
