import { randomUUID, timingSafeEqual } from "node:crypto";

import { Body, Controller, Header, HttpCode, Inject, Optional, Param, Post } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { assessQaIntakeCompleteness, selectQaIntakeQuestions } from "@awp/competency-qa";
import {
  createHermesContextClient,
  type HermesContextPort,
  localHermesContext,
  QaIntakeDraftService,
} from "@awp/runtime-composition";

import { command, digest, object, reject, safeResult, text } from "../onboarding/durable-http.ts";
import { QA_DATA_SOURCE } from "../qa-api-authorization.ts";
import { QA_INTAKE_CONFIGURATION, type QaIntakeConfiguration } from "../qa-intake-configuration.ts";
import { loadHermesMattermostBindings } from "./mattermost-config.ts";
import { confirmMattermostRequest, previewMattermostRequest } from "./mattermost-confirmation.ts";
import { readMattermostProjectContext } from "./project-context-reader.ts";

/** Native slash responses are private to the caller; no response_url or bot POST is used. */
@Controller("api/v1/hermes/mattermost")
export class HermesMattermostController {
  private readonly bindings = loadHermesMattermostBindings();
  private readonly hermes: HermesContextPort = process.env.AWP_HERMES_URL
    ? createHermesContextClient()
    : { respond: async (input) => localHermesContext(input) };
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Optional()
    @Inject(QA_INTAKE_CONFIGURATION)
    private readonly configuration?: QaIntakeConfiguration,
  ) {}
  @Post(["", ":bindingKey"])
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  respond(@Param("bindingKey") bindingKey: string | undefined, @Body() supplied: unknown) {
    return safeResult(async () => {
      const b = object(supplied, [
        "token",
        "team_id",
        "team_domain",
        "channel_id",
        "channel_name",
        "user_id",
        "user_name",
        "command",
        "text",
        "response_url",
        "trigger_id",
      ]);
      // One team slash command serves multiple project channels. The channel selects an
      // operator binding whose secret is checked below; text never selects authority.
      const binding = this.bindings.find((candidate) =>
        bindingKey
          ? candidate.key === bindingKey
          : candidate.teamId === b.team_id && candidate.channelId === b.channel_id,
      );
      if (!binding) return reject("HERMES_MATTERMOST_SCOPE_DENIED", 403);
      const token = Buffer.from(typeof b.token === "string" ? b.token : ""),
        expected = Buffer.from(binding.token);
      if (token.length !== expected.length || !timingSafeEqual(token, expected))
        return reject("HERMES_MATTERMOST_UNAUTHORIZED", 401);
      if (
        b.team_id !== binding.teamId ||
        b.channel_id !== binding.channelId ||
        b.command !== "/hermes"
      )
        return reject("HERMES_MATTERMOST_SCOPE_DENIED", 403);
      const message = text(b.text, 4000),
        match = /^(ask|test|preview|confirm)\s+([\s\S]+)$/u.exec(message);
      if (!match)
        return {
          response_type: "ephemeral",
          text: "Hermes: /hermes ask <вопрос о проекте> или /hermes test <описание проверки>. Проект определяется каналом. Запросы сначала сохраняются как черновики.",
        };
      const externalUserId = text(b.user_id, 100);
      if (match[1] === "preview")
        return previewMattermostRequest(
          this.source,
          binding,
          externalUserId,
          text(match[2], 36),
          this.configuration,
        );
      if (match[1] === "confirm")
        return confirmMattermostRequest(
          this.source,
          binding,
          externalUserId,
          text(match[2], 1800),
          this.configuration,
        );
      const operation = match[1] as "ask" | "test",
        question = text(match[2], 2000),
        trigger = text(b.trigger_id, 512);
      const requestKey = `hermes-mm:${digest({ binding: binding.key, trigger })}`,
        permission = operation === "test" ? "qa.request.create" : "work-item.read";
      const prepared = await this.source.transaction(async (manager) => {
        const current = await readMattermostProjectContext(
          manager,
          binding,
          externalUserId,
          permission,
        );
        const requestHash = digest({
          operation,
          question,
          externalUserId,
          team: binding.teamId,
          channel: binding.channelId,
          bindingVersion: binding.version,
        });
        const [receipt] = (await manager.query(
          "SELECT request_hash,result_ref FROM client_request_idempotency WHERE workspace_id=$1 AND project_id=$2 AND actor_id=$3 AND operation='hermes.mattermost' AND client_key=$4",
          [binding.workspaceId, binding.projectId, current.principalId, requestKey],
        )) as { request_hash: string; result_ref: { response_type: string; text: string } }[];
        if (receipt && receipt.request_hash !== requestHash)
          return reject("IDEMPOTENCY_CONFLICT", 409);
        return { ...current, requestHash, receipt: receipt?.result_ref };
      });
      if (prepared.receipt) return prepared.receipt;
      const proposal = await this.hermes.respond({
        schemaVersion: 1,
        requestKey,
        operation,
        message: question,
        context: prepared.context,
      });
      return this.source.transaction("SERIALIZABLE", async (manager) => {
        const current = await readMattermostProjectContext(
          manager,
          binding,
          externalUserId,
          permission,
        );
        if (
          current.principalId !== prepared.principalId ||
          current.identityVersion !== prepared.identityVersion ||
          digest(current.context) !== digest(prepared.context)
        )
          return reject("HERMES_PROJECT_CONTEXT_CHANGED", 409);
        // Existing receipt identity covers request bytes, and the closure below is executed once.
        return command(
          manager,
          binding,
          current.principalId,
          "hermes.mattermost",
          requestKey,
          {
            operation,
            question,
            externalUserId,
            team: binding.teamId,
            channel: binding.channelId,
            bindingVersion: binding.version,
          },
          async () => {
            const plain = (value: string) => value.replace(/([\\`*_{}[\]()<>!@])/gu, "\\$1");
            if (operation === "ask")
              return {
                response_type: "ephemeral",
                text: `${plain(proposal.answer)}\nИсточник: карточка ${plain(current.context.key)} v${current.context.version}${current.context.qa ? `, QA v${current.context.qa.version}` : ""}.`,
              };
            const created = await new QaIntakeDraftService(this.source).createInTransaction(
              manager,
              {
                ...binding,
                principalId: current.principalId,
                requestKey,
                content: {
                  schemaVersion: 1,
                  requestKind: "feature-validation",
                  ...proposal.proposal!,
                  requestedClassificationKey: current.authority.classification,
                },
                sourceKind: "MATTERMOST_DIALOG",
              },
            );
            const check = assessQaIntakeCompleteness({
              workspaceId: binding.workspaceId,
              projectId: binding.projectId,
              draftId: created.draft.id,
              revision: created.draft.revision,
              contentHash: created.draft.contentHash as `sha256:${string}`,
              content: created.draft.content,
            });
            const questions = selectQaIntakeQuestions({
              missingFields: check.missingFields as string[],
              invalidFields: check.invalidFields as string[],
            }).map((q) => q.prompt);
            const correlationId = randomUUID();
            await manager.query(
              "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,'hermes.mattermost.draft.created','SUCCEEDED','HERMES_QA_DRAFT_CREATED',$1,$1,$5,$6,$7)",
              [
                correlationId,
                binding.workspaceId,
                binding.projectId,
                current.authority.actor,
                current.authority.basis,
                current.authority.classification,
                {
                  draftId: created.draft.id,
                  mode: proposal.mode,
                  requestHash: prepared.requestHash,
                  contextHash: digest(current.context),
                  skillVersion: "hermes.qa-intake@1",
                },
              ],
            );
            return {
              response_type: "ephemeral",
              text: `Создан черновик QA-запроса в проекте ${plain(current.context.key)}: ${plain(String(created.draft.content.title))}.\n${questions.length ? `Нужно уточнить: ${questions.join("; ")}.` : "Проверьте цель, область и ожидаемый результат."}\nДля карточки и подтверждения в чате: /hermes preview ${created.draft.id}\nЗапрос ещё не принят; Jira и запуск проверок требуют явного подтверждения.`,
            };
          },
        );
      });
    });
  }
}
