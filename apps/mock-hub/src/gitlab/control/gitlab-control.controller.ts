import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Optional,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import {
  parseGitLabMockFault,
  parseGitLabMockOperation,
  resolveGitLabScenario,
} from "../scenarios/gitlab-scenarios.ts";
import { TypeOrmGitLabRepository } from "../state/gitlab.repository.ts";
import {
  type GitLabMockWebhookEventKind,
  GitLabWebhookEmitter,
} from "../webhooks/gitlab-webhook-emitter.ts";

export interface GitLabMockControlAuthorizationInput {
  readonly expectedControlKey: string;
  readonly providedControlKey: string | undefined;
  readonly numericProjectId: number;
  readonly allowedProjectIds: readonly number[];
}

export function authorizeGitLabMockControl(
  input: GitLabMockControlAuthorizationInput,
): Readonly<{ numericProjectId: number }> {
  if (!input.expectedControlKey || input.providedControlKey !== input.expectedControlKey)
    throw new Error("GITLAB_MOCK_CONTROL_UNAUTHORIZED");
  if (
    !Number.isSafeInteger(input.numericProjectId) ||
    !input.allowedProjectIds.includes(input.numericProjectId)
  )
    throw new Error("GITLAB_MOCK_CONTROL_SCOPE_FORBIDDEN");
  return Object.freeze({ numericProjectId: input.numericProjectId });
}

export class GitLabMockControlPolicy {
  constructor(
    readonly expectedControlKey: string,
    readonly allowedProjectIds: readonly number[],
  ) {}
}

function projectId(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 1)
    throw new BadRequestException({ code: "GITLAB_MOCK_PROJECT_ID_INVALID" });
  return result;
}

@Controller("mock/gitlab")
export class GitLabControlController {
  constructor(
    @Inject(TypeOrmGitLabRepository) private readonly repository: TypeOrmGitLabRepository,
    @Inject(GitLabMockControlPolicy) private readonly policy: GitLabMockControlPolicy,
    @Optional() @Inject(GitLabWebhookEmitter) private readonly webhooks?: GitLabWebhookEmitter,
  ) {}

  #authorize(key: string | undefined, id: number): void {
    try {
      authorizeGitLabMockControl({
        expectedControlKey: this.policy.expectedControlKey,
        providedControlKey: key,
        numericProjectId: id,
        allowedProjectIds: this.policy.allowedProjectIds,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNAUTHORIZED"))
        throw new UnauthorizedException({ code: error.message });
      throw new ForbiddenException({
        code: error instanceof Error ? error.message : "GITLAB_MOCK_CONTROL_FORBIDDEN",
      });
    }
  }

  @Get("state")
  async state(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Query("project_id") rawProjectId: string | undefined,
  ) {
    const id = projectId(rawProjectId);
    this.#authorize(key, id);
    return await this.repository.snapshot(id);
  }

  @Post("fault")
  async fault(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Body() body: Readonly<Record<string, unknown>>,
  ) {
    const id = projectId(body.projectId);
    this.#authorize(key, id);
    await this.repository.setFault({
      projectId: id,
      operation: parseGitLabMockOperation(body.operation),
      fault: parseGitLabMockFault(body.fault),
      remaining: typeof body.remaining === "number" ? body.remaining : 1,
    });
    return Object.freeze({ ok: true });
  }

  @Post("scenario")
  async scenario(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Body() body: Readonly<Record<string, unknown>>,
  ) {
    const id = projectId(body.projectId);
    this.#authorize(key, id);
    const scenario = resolveGitLabScenario(body.scenarioId);
    if (scenario.discovery.numericProjectId !== id)
      throw new ForbiddenException({ code: "GITLAB_MOCK_SCENARIO_SCOPE_FORBIDDEN" });
    await this.repository.applyScenario(scenario);
    const delivery =
      scenario.id.startsWith("us4-") && this.webhooks !== undefined
        ? await this.webhooks.emit({
            projectId: id,
            pipelineId: scenario.build.pipelineId,
            deliveryId: scenario.id,
            ...(scenario.attemptResults.at(-1)?.terminalAt === undefined
              ? {}
              : { emittedAt: scenario.attemptResults.at(-1)!.terminalAt }),
          })
        : undefined;
    return Object.freeze({
      scenarioId: scenario.id,
      projectId: id,
      status: "READY",
      triggerFault: scenario.triggerFault,
      lookupFault: scenario.lookupFault,
      webhookFault: scenario.webhookFault,
      readFault: scenario.readFault,
      ...(delivery === undefined ? {} : { delivery }),
    });
  }

  @Post("webhook")
  async webhook(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Body() body: Readonly<Record<string, unknown>>,
  ) {
    const id = projectId(body.projectId);
    this.#authorize(key, id);
    if (!this.webhooks)
      throw new ServiceUnavailableException({ code: "GITLAB_MOCK_WEBHOOK_EMITTER_UNAVAILABLE" });
    const eventKind = body.eventKind;
    if (eventKind !== undefined && eventKind !== "PIPELINE_HOOK" && eventKind !== "JOB_HOOK")
      throw new BadRequestException({ code: "GITLAB_MOCK_WEBHOOK_EVENT_KIND_INVALID" });
    return await this.webhooks.emit({
      projectId: id,
      ...(eventKind === undefined ? {} : { eventKind: eventKind as GitLabMockWebhookEventKind }),
      ...(body.pipelineId === undefined ? {} : { pipelineId: projectId(body.pipelineId) }),
      ...(body.jobId === undefined ? {} : { jobId: projectId(body.jobId) }),
      ...(typeof body.deliveryId === "string" ? { deliveryId: body.deliveryId } : {}),
      ...(typeof body.emittedAt === "string" ? { emittedAt: body.emittedAt } : {}),
    });
  }

  @Get("webhook/next")
  async nextWebhook(
    @Headers("x-awp-mock-control-key") key: string | undefined,
    @Query("project_id") rawProjectId: string | undefined,
  ) {
    const id = projectId(rawProjectId);
    this.#authorize(key, id);
    if (!this.webhooks)
      throw new ServiceUnavailableException({ code: "GITLAB_MOCK_WEBHOOK_EMITTER_UNAVAILABLE" });
    const packet = await this.webhooks.next(id);
    if (!packet) return Object.freeze({ delivery: null });
    return Object.freeze({
      delivery: Object.freeze({
        deliveryId: packet.deliveryId,
        eventKind: packet.eventKind,
        contentType: packet.contentType,
        rawBodyBase64: Buffer.from(packet.rawBody).toString("base64"),
        headers: Object.freeze({
          "webhook-id": packet.headers.webhookId,
          "webhook-timestamp": packet.headers.webhookTimestamp,
          "webhook-signature": packet.headers.webhookSignature,
        }),
        deliveryAttempt: packet.deliveryAttempt,
        duplicate: packet.duplicate,
      }),
    });
  }
}
