import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  createOnboardingRevision,
  createProjectActionCandidate,
  type ExactRevisionRef,
  type ProjectActionCandidate,
  type ProjectOnboardingRevision,
} from "@awp/platform-core";
import { ProjectOnboardingRepository } from "@awp/platform-persistence-typeorm";

import {
  bindingHead,
  bindingHeadRef,
  bindingRevision,
  pilotFacts,
  publicationFacts,
  sortedRefs,
} from "./binding-facts.ts";
import {
  type AdministrativeAuthority,
  appendOnboarding,
  auditAndEvent,
  authorizeAdministrative,
  command,
  digest,
  lockOnboarding,
  type OnboardingRequest,
  ref,
  reject,
  same,
} from "./durable-http.ts";
import {
  consumeOperationalApproval,
  loadOperationalCandidate,
  saveOperationalCandidate,
} from "./project-operations.application.ts";

export const BINDING_HTTP_APPLICATION = "BINDING_HTTP_APPLICATION";
export type BindingLifecycleAction = "publish" | "retire" | "rollback";
export function bindingLifecycleAction(value: unknown): BindingLifecycleAction {
  if (value !== "publish" && value !== "retire" && value !== "rollback")
    return reject("BINDING_LIFECYCLE_ACTION_INVALID", 400);
  return value;
}
const operationRef = (operation: string, target: ExactRevisionRef) =>
  ref(`binding-operation:${operation}`, 1, digest({ operation, target }));
const revisionRef = (revision: ProjectOnboardingRevision) =>
  ref(revision.revisionId, revision.version, revision.contentHash);
const scopeArgs = (request: OnboardingRequest) => [request.workspaceId, request.projectId];
export class DurableBindingHttpApplication {
  constructor(private readonly source: DataSource) {}
  private async transaction<T>(
    request: OnboardingRequest,
    permission: string,
    key: string,
    input: unknown,
    work: (
      manager: EntityManager,
      current: ProjectOnboardingRevision,
      authority: AdministrativeAuthority,
    ) => Promise<T>,
  ): Promise<T> {
    await request.authorize(permission);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request);
      const authority = await authorizeAdministrative(
        manager,
        request,
        permission,
        "system-administrator",
        true,
      );
      return command(
        manager,
        request,
        authority.actor.principalId,
        permission,
        key,
        input,
        async () => {
          const result = await work(manager, current, authority);
          await request.authorize(permission);
          return result;
        },
      );
    });
  }
  private async bindingFacts(
    manager: EntityManager,
    current: ProjectOnboardingRevision,
    target: ExactRevisionRef,
    operation: BindingLifecycleAction,
  ) {
    const head = await bindingHead(manager, current, target.id),
      revision = await bindingRevision(manager, current, target);
    const prerequisites = [operationRef(operation, target), bindingHeadRef(target.id, head)];
    if (operation === "publish") {
      if (revision.status !== "DRAFT" && revision.status !== "VALIDATED")
        return reject("BINDING_DRAFT_REQUIRED", 409);
      prerequisites.push(...(await publicationFacts(manager, current, target, revision)));
      if (current.bindingRef && current.bindingRef.id !== target.id) {
        const previousHead = await bindingHead(manager, current, current.bindingRef.id);
        const previous = await bindingRevision(manager, current, current.bindingRef);
        if (
          previous.status !== "PUBLISHED" ||
          previousHead.current_published_version !== current.bindingRef.version
        )
          return reject("BINDING_PREVIOUS_HEAD_STALE", 409);
        prerequisites.push(bindingHeadRef(current.bindingRef.id, previousHead), current.bindingRef);
      }
    } else if (operation === "retire") {
      if (
        revision.status !== "PUBLISHED" ||
        head.current_published_version !== target.version ||
        !same(current.bindingRef, target)
      )
        return reject("BINDING_RETIRE_TARGET_NOT_CURRENT", 409);
    } else if (!["PUBLISHED", "RETIRED"].includes(revision.status))
      return reject("BINDING_ROLLBACK_SOURCE_INVALID", 409);
    return { head, revision, refs: sortedRefs(prerequisites) };
  }
  async prepare(
    request: OnboardingRequest,
    input: Readonly<{
      expectedVersion: number;
      operation: BindingLifecycleAction;
      bindingRef: ExactRevisionRef;
      reason: string;
    }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "integration.publish",
      key,
      { commandKind: "prepare-binding", ...input },
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion)
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const facts = await this.bindingFacts(manager, current, input.bindingRef, input.operation),
          now = new Date();
        const candidate = createProjectActionCandidate({
          actionId: randomUUID(),
          kind: input.operation === "retire" ? "BINDING_RETIRE" : "BINDING_PUBLISH",
          workspaceId: request.workspaceId,
          projectId: request.projectId,
          targetRef: input.bindingRef,
          expectedOnboardingVersion: current.version,
          prerequisiteRefs: facts.refs,
          initiator: authority.human,
          reason: input.reason,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 300_000).toISOString(),
        });
        await saveOperationalCandidate(manager, candidate);
        await auditAndEvent(
          manager,
          request,
          authority,
          "BINDING_ACTION_REQUESTED",
          ref(candidate.actionId, 1, candidate.contentHash),
          input.reason,
          "PROJECT_BINDING_CHANGED",
        );
        return {
          status: "PENDING_APPROVAL" as const,
          resultRef: ref(candidate.actionId, 1, candidate.contentHash),
          candidate,
        };
      },
    );
  }
  async apply(
    request: OnboardingRequest,
    bindingId: string,
    operation: BindingLifecycleAction,
    input: Readonly<{
      expectedVersion: number;
      candidateRef: ExactRevisionRef;
      approvalRef: ExactRevisionRef;
    }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "integration.publish",
      key,
      { operation: `binding-${operation}`, bindingId, ...input },
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion)
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const candidate = await loadOperationalCandidate(manager, request, input.candidateRef);
        if (
          candidate.targetRef.id !== bindingId ||
          candidate.kind !== (operation === "retire" ? "BINDING_RETIRE" : "BINDING_PUBLISH") ||
          candidate.initiator.principalId !== authority.actor.principalId
        )
          return reject("BINDING_EXACT_ACTION_MISMATCH", 409);
        const facts = await this.bindingFacts(manager, current, candidate.targetRef, operation);
        if (!same(sortedRefs(candidate.prerequisiteRefs), facts.refs))
          return reject("BINDING_PREREQUISITE_STALE", 409);
        await consumeOperationalApproval(
          manager,
          request,
          candidate,
          input.approvalRef,
          current.version,
        );
        const now = new Date().toISOString();
        let resultRef = candidate.targetRef;
        if (operation === "rollback") {
          const version = facts.head.max_version + 1,
            revisionId = randomUUID();
          const content = { ...facts.revision.content };
          if (content.revisionId) {
            Object.assign(content, {
              revisionId,
              version,
              createdAt: now,
              createdBy: authority.actor.principalId,
              authorizationBasis: authority.basis,
            });
            delete content.validatedAt;
            delete content.publishedAt;
            delete content.retiredAt;
          }
          await manager.query(
            "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8)",
            [
              revisionId,
              ...scopeArgs(request),
              bindingId,
              version,
              content,
              facts.revision.content_hash,
              now,
            ],
          );
          await manager.query(
            "UPDATE project_integration_binding_headers SET row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [...scopeArgs(request), bindingId],
          );
          resultRef = ref(bindingId, version, facts.revision.content_hash);
        } else {
          if (
            operation === "publish" &&
            current.bindingRef &&
            current.bindingRef.id !== bindingId
          ) {
            await manager.query(
              "UPDATE project_integration_binding_revisions SET status='RETIRED',retired_at=$4 WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
              [...scopeArgs(request), current.bindingRef.id, now],
            );
            await manager.query(
              "UPDATE project_integration_binding_headers SET current_published_version=NULL,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
              [...scopeArgs(request), current.bindingRef.id],
            );
          }
          await manager.query(
            "UPDATE project_integration_binding_revisions SET status='RETIRED',retired_at=$4 WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
            [...scopeArgs(request), bindingId, now],
          );
          if (operation === "publish")
            await manager.query(
              "UPDATE project_integration_binding_revisions SET status='PUBLISHED',published_at=$5 WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4",
              [...scopeArgs(request), bindingId, candidate.targetRef.version, now],
            );
          await manager.query(
            "UPDATE project_integration_binding_headers SET current_published_version=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [
              ...scopeArgs(request),
              bindingId,
              operation === "publish" ? candidate.targetRef.version : null,
            ],
          );
        }
        const { contentHash: _hash, ...body } = current;
        void _hash;
        const next = createOnboardingRevision({
          ...body,
          revisionId: randomUUID(),
          version: current.version + 1,
          ...(operation === "rollback"
            ? {}
            : {
                stage: "VALIDATING" as const,
                qaCapabilityMode: "MANUAL_ONLY",
                bindingRef: operation === "publish" ? resultRef : current.bindingRef!,
                gateResultRefs: [],
              }),
          reasonCode:
            operation === "publish"
              ? "BINDING_PUBLISHED"
              : operation === "retire"
                ? "BINDING_RETIRED"
                : "BINDING_ROLLBACK_DRAFT_CREATED",
          reason: candidate.reason,
          actor: authority.human,
          createdAt: now,
          correlationId: randomUUID(),
          causationId: candidate.actionId,
        });
        await appendOnboarding(manager, next);
        const result = {
          status: "COMPLETED" as const,
          action: operation,
          resultRef,
          onboardingRef: revisionRef(next),
          version: next.version,
          state:
            operation === "rollback" ? "DRAFT" : operation === "publish" ? "PUBLISHED" : "RETIRED",
        };
        await this.finish(
          manager,
          request,
          candidate,
          result,
          authority,
          next.reasonCode,
          resultRef,
        );
        return result;
      },
    );
  }
  async preparePilot(
    request: OnboardingRequest,
    input: Readonly<{ expectedVersion: number; reason: string }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "project.onboarding.activate",
      key,
      { operation: "prepare-pilot", ...input },
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion)
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const prerequisites = await pilotFacts(manager, current),
          now = new Date();
        const candidate = createProjectActionCandidate({
          actionId: randomUUID(),
          kind: "ONBOARDING_PILOT_ACTIVATE",
          workspaceId: request.workspaceId,
          projectId: request.projectId,
          targetRef: revisionRef(current),
          expectedOnboardingVersion: current.version,
          prerequisiteRefs: prerequisites,
          initiator: authority.human,
          reason: input.reason,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 300_000).toISOString(),
        });
        await saveOperationalCandidate(manager, candidate);
        await auditAndEvent(
          manager,
          request,
          authority,
          "PILOT_ACTIVATION_REQUESTED",
          ref(candidate.actionId, 1, candidate.contentHash),
          input.reason,
        );
        return {
          status: "PENDING_APPROVAL" as const,
          resultRef: ref(candidate.actionId, 1, candidate.contentHash),
          candidate,
        };
      },
    );
  }
  async activatePilot(
    request: OnboardingRequest,
    input: Readonly<{
      expectedVersion: number;
      candidateRef: ExactRevisionRef;
      approvalRef: ExactRevisionRef;
    }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "project.onboarding.activate",
      key,
      { operation: "activate-pilot", ...input },
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion)
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const candidate = await loadOperationalCandidate(manager, request, input.candidateRef),
          prerequisites = await pilotFacts(manager, current);
        if (
          candidate.kind !== "ONBOARDING_PILOT_ACTIVATE" ||
          candidate.initiator.principalId !== authority.actor.principalId ||
          !same(candidate.targetRef, revisionRef(current)) ||
          !same(sortedRefs(candidate.prerequisiteRefs), prerequisites)
        )
          return reject("PILOT_PREREQUISITES_CHANGED", 409);
        const approval = await consumeOperationalApproval(
          manager,
          request,
          candidate,
          input.approvalRef,
          current.version,
        );
        const now = new Date().toISOString();
        let lease: Readonly<{ leaseVersion: number }>;
        try {
          lease = await new ProjectOnboardingRepository(
            this.source,
          ).acquireFirstPilotRolloutLeaseInTransaction(manager, {
            workspaceId: request.workspaceId,
            projectId: request.projectId,
            actorId: approval.approver.principalId,
            acquiredAt: now,
            expiresAt: candidate.expiresAt,
          });
        } catch (error) {
          if (error instanceof Error && error.message === "ROLLOUT_LEASE_HELD")
            return reject("ROLLOUT_LEASE_HELD", 409);
          throw error;
        }
        const { contentHash: _hash, ...body } = current;
        void _hash;
        const next = createOnboardingRevision({
          ...body,
          revisionId: randomUUID(),
          version: current.version + 1,
          stage: "PILOT_ACTIVE",
          reasonCode: "ONBOARDING_PILOT_ACTIVATED",
          reason: candidate.reason,
          actor: approval.approver,
          createdAt: now,
          correlationId: randomUUID(),
          causationId: candidate.actionId,
        });
        await appendOnboarding(manager, next);
        const result = {
          status: "COMPLETED" as const,
          resultRef: revisionRef(next),
          version: next.version,
          stage: next.stage,
          leaseVersion: lease.leaseVersion,
        };
        await this.finish(
          manager,
          request,
          candidate,
          result,
          authority,
          next.reasonCode,
          revisionRef(next),
        );
        return result;
      },
    );
  }
  private async finish(
    manager: EntityManager,
    request: OnboardingRequest,
    candidate: ProjectActionCandidate,
    result: unknown,
    authority: AdministrativeAuthority,
    action: string,
    resultRef: ExactRevisionRef,
  ) {
    await manager.query(
      "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [...scopeArgs(request), candidate.actionId, result],
    );
    await auditAndEvent(
      manager,
      request,
      authority,
      action,
      resultRef,
      candidate.reason,
      action.startsWith("BINDING") ? "PROJECT_BINDING_CHANGED" : "PROJECT_ONBOARDING_CHANGED",
    );
  }
}
