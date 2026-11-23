import {
  type Clock,
  type IdGenerator,
  requireProjectScope,
  type WorkspaceContext,
} from "@awp/platform-core";

import { type DummyRequest, validateDummyIntake } from "../domain/dummy-request.ts";
import type { DummyRequestRepository } from "../persistence/dummy-request.repository.ts";

export class DummyRequestApplicationService {
  constructor(
    private readonly repository: DummyRequestRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async create(
    context: WorkspaceContext,
    workItemId: string,
    input: unknown,
  ): Promise<DummyRequest> {
    const scope = requireProjectScope(context.scope);
    const parsed = validateDummyIntake(input);
    const createdAt = this.clock.now();
    const request = Object.freeze({
      id: this.ids.next(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId,
      ...parsed,
      history: Object.freeze([
        {
          at: createdAt.toISOString(),
          action: "CREATED" as const,
          actorId: context.actor.principalId,
        },
      ]),
      rowVersion: 1,
      createdAt,
    });
    await this.repository.insert(scope, request);
    return request;
  }
  async get(context: WorkspaceContext, workItemId: string): Promise<DummyRequest | undefined> {
    return this.repository.getByWorkItem(requireProjectScope(context.scope), workItemId);
  }
}
