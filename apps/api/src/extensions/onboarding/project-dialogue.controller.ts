import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Optional,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import type { ProjectDialogueView } from "@awp/competency-ui-sdk";
import {
  createHermesDialogueClient,
  HERMES_PROJECT_DIALOGUE,
  type HermesDialoguePort,
  type HermesProposal,
} from "@awp/runtime-composition";

import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { digest, object, reject, safeResult, text, uuid } from "./durable-http.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "./registry.application.ts";

type Row = {
  id: string;
  workspace_id: string;
  version: number;
  state: ProjectDialogueView["state"];
  draft: ProjectDialogueView["draft"];
  messages: ProjectDialogueView["messages"];
  project_id: string | null;
};
const view = (row: Row): ProjectDialogueView => ({
  schemaVersion: 1,
  id: row.id,
  workspaceId: row.workspace_id,
  version: row.version,
  state: row.state,
  draft: row.draft,
  messages: row.messages,
  ...(row.project_id ? { projectId: row.project_id } : {}),
});

/** The dialogue collects proposals; confirmation executes as the verified human. */
@Controller("api/v1/workspaces/:workspaceId/project-dialogues")
@UseGuards(QaSessionGuard)
export class ProjectDialogueController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(REGISTRY_HTTP_APPLICATION) private readonly registry: DurableRegistryHttpApplication,
    @Optional()
    @Inject(HERMES_PROJECT_DIALOGUE)
    private readonly hermes: HermesDialoguePort = createHermesDialogueClient(),
  ) {}

  private async row(manager: EntityManager, workspaceId: string, principalId: string, id: string) {
    const [row] = (await manager.query(
      "SELECT * FROM project_registration_dialogues WHERE workspace_id=$1 AND principal_id=$2 AND id=$3 FOR UPDATE",
      [workspaceId, principalId, id],
    )) as Row[];
    if (!row) return reject("PROJECT_DIALOGUE_NOT_FOUND", 404);
    return row;
  }
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: QaSessionRequest, @Param("workspaceId") workspaceId: string) {
    return safeResult(() =>
      this.source.transaction(async (manager) => {
        uuid(workspaceId);
        const session = await this.registry.authorizeDialogue(request, workspaceId, manager);
        const rows = (await manager.query(
          "SELECT * FROM project_registration_dialogues WHERE workspace_id=$1 AND principal_id=$2 ORDER BY updated_at DESC,id LIMIT 20",
          [workspaceId, session.principalId],
        )) as Row[];
        return { items: rows.map(view) };
      }),
    );
  }
  @Post()
  @Header("Cache-Control", "private, no-store")
  start(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() input: unknown,
  ) {
    return safeResult(() =>
      this.source.transaction(async (manager) => {
        uuid(workspaceId);
        const b = object(input, ["id"]),
          id = uuid(b.id);
        const session = await this.registry.authorizeDialogue(request, workspaceId, manager);
        await manager.query(
          `INSERT INTO project_registration_dialogues(id,workspace_id,principal_id,state,draft,messages)
        VALUES($1,$2,$3,'COLLECTING',$4,$5) ON CONFLICT(id) DO NOTHING`,
          [
            id,
            workspaceId,
            session.principalId,
            JSON.stringify({ key: `P-${id.replaceAll("-", "").slice(0, 16).toUpperCase()}` }),
            JSON.stringify([
              {
                role: "assistant",
                text: "Расскажите, какой проект хотите завести. Как он называется и для чего нужен?",
              },
            ]),
          ],
        );
        return view(await this.row(manager, workspaceId, session.principalId, id));
      }),
    );
  }
  private async command(
    request: QaSessionRequest,
    workspaceId: string,
    id: string,
    input: unknown,
    confirm: boolean,
  ) {
    uuid(workspaceId);
    uuid(id);
    const b = object(
      input,
      confirm ? ["expectedVersion", "requestKey"] : ["expectedVersion", "requestKey", "message"],
    );
    const requestKey = uuid(b.requestKey);
    if (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 1)
      return reject("PROJECT_DIALOGUE_VERSION_INVALID", 400);
    const message = confirm ? "" : text(b.message, 2000);
    const hash = digest({ confirm, expectedVersion: b.expectedVersion, message });
    // Release DB locks before any service/model I/O. The commit transaction below
    // repeats authority, ownership, version and receipt checks after that wait.
    let proposal: HermesProposal | undefined;
    if (!confirm) {
      const prepared = await this.source.transaction(async (manager) => {
        const session = await this.registry.authorizeDialogue(request, workspaceId, manager);
        const row = await this.row(manager, workspaceId, session.principalId, id);
        const [replay] = (await manager.query(
          "SELECT request_hash,response FROM project_dialogue_commands WHERE dialogue_id=$1 AND request_key=$2",
          [id, requestKey],
        )) as { request_hash: string; response: ProjectDialogueView }[];
        if (replay) {
          if (replay.request_hash !== hash) return reject("PROJECT_DIALOGUE_REQUEST_CONFLICT", 409);
          return { replay: replay.response };
        }
        if (row.version !== b.expectedVersion) return reject("PROJECT_DIALOGUE_STALE", 409);
        if (row.state === "CREATED") return reject("PROJECT_DIALOGUE_ALREADY_CREATED", 409);
        if (row.messages.length >= 61) return reject("PROJECT_DIALOGUE_LIMIT", 400);
        return { draft: row.draft, principalId: session.principalId };
      });
      if (prepared.replay) return prepared.replay;
      try {
        proposal = await this.hermes.advance({
          schemaVersion: 1,
          workspaceId,
          principalId: prepared.principalId!,
          dialogueId: id,
          requestKey,
          expectedVersion: Number(b.expectedVersion),
          draft: prepared.draft!,
          message,
        });
      } catch {
        return reject("PROJECT_DIALOGUE_MESSAGE_INVALID", 400);
      }
    }
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      // Registration takes its advisory lock before the workspace row lock.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `project-onboarding:${workspaceId}`,
      ]);
      await manager.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
      const session = await this.registry.authorizeDialogue(request, workspaceId, manager, confirm);
      const row = await this.row(manager, workspaceId, session.principalId, id);
      const [replay] = (await manager.query(
        "SELECT request_hash,response FROM project_dialogue_commands WHERE dialogue_id=$1 AND request_key=$2",
        [id, requestKey],
      )) as { request_hash: string; response: ProjectDialogueView }[];
      if (replay) {
        if (replay.request_hash !== hash) return reject("PROJECT_DIALOGUE_REQUEST_CONFLICT", 409);
        return replay.response;
      }
      if (row.version !== b.expectedVersion) return reject("PROJECT_DIALOGUE_STALE", 409);
      if (row.state === "CREATED") return reject("PROJECT_DIALOGUE_ALREADY_CREATED", 409);
      let next: Row;
      if (confirm) {
        if (row.state !== "READY" || !row.draft.name || !row.draft.purpose)
          return reject("PROJECT_DIALOGUE_INCOMPLETE", 409);
        const result = await this.registry.registerOwn(
          request,
          workspaceId,
          { key: row.draft.key, name: row.draft.name, purpose: row.draft.purpose },
          `hermes-project:${id}`,
          manager,
        );
        next = {
          ...row,
          version: row.version + 1,
          state: "CREATED",
          project_id: result.projectId,
          messages: [
            ...row.messages,
            {
              role: "assistant",
              text: "Проект создан. Он доступен вам и рабочей команде. Подключения и готовность к работе настраиваются отдельно.",
            },
          ],
        };
      } else {
        if (row.messages.length >= 61) return reject("PROJECT_DIALOGUE_LIMIT", 400);
        const result = proposal!;
        next = {
          ...row,
          ...result,
          version: row.version + 1,
          messages: [
            ...row.messages,
            { role: "user", text: message },
            { role: "assistant", text: result.reply },
          ],
        };
      }
      await manager.query(
        "UPDATE project_registration_dialogues SET version=$2,state=$3,draft=$4,messages=$5,project_id=$6,updated_at=clock_timestamp() WHERE id=$1",
        [
          id,
          next.version,
          next.state,
          JSON.stringify(next.draft),
          JSON.stringify(next.messages),
          next.project_id,
        ],
      );
      const response = view(next);
      await manager.query(
        "INSERT INTO project_dialogue_commands(dialogue_id,request_key,request_hash,response) VALUES($1,$2,$3,$4)",
        [id, requestKey, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
  @Post(":id/messages")
  @Header("Cache-Control", "private, no-store")
  message(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return safeResult(() => this.command(request, workspaceId, id, input, false));
  }
  @Post(":id/confirm")
  @Header("Cache-Control", "private, no-store")
  confirm(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return safeResult(() => this.command(request, workspaceId, id, input, true));
  }
}
