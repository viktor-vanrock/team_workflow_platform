import { createHash, randomUUID } from "node:crypto";

import { HttpException, Inject, Injectable } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  changeDocument,
  type DocumentAction,
  documentActions,
  type DocumentDetail,
  DocumentError,
  type DocumentHistory,
  newDocument,
  type ServiceDocument,
} from "@awp/competency-tech-writing";
import { defaultClassificationCatalog } from "@awp/platform-core";
import {
  loadEnvironment,
  localPersonaCatalog,
  workspaceRoleCatalog,
} from "@awp/runtime-composition";

import {
  type AdministrativeAuthority,
  command,
  currentAuthority,
  etag,
  object,
  reject,
  text,
  uuid,
} from "../extensions/onboarding/durable-http.ts";
import { QA_DATA_SOURCE } from "../extensions/qa-api-authorization.ts";
import type { LocalSessionRequest } from "./local-session.guard.ts";

type Scope = Readonly<{ workspaceId: string; projectId: string }>;
type Access = AdministrativeAuthority & { permissions: readonly string[]; label: string };
export const documentHash = (body: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
const actionPermission = {
  save: "docs.edit",
  submit: "docs.submit",
  return: "docs.review",
  approve: "docs.review",
} as const;

@Injectable()
export class TechWritingService {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  private async transaction<T>(
    request: LocalSessionRequest,
    scope: Scope,
    permission: string,
    work: (manager: EntityManager, access: Access) => Promise<T>,
  ): Promise<T> {
    if (process.env.AWP_RUNTIME_PROFILE !== "local" && process.env.AWP_RUNTIME_PROFILE !== "test")
      return reject("DOC_LOCAL_ONLY", 403);
    uuid(scope.workspaceId);
    uuid(scope.projectId);
    if (!request.localPersonaKey) return reject("DOC_IDENTITY_REQUIRED", 401);
    const persona = localPersonaCatalog.resolve(request.localPersonaKey);
    if (persona.kind !== "HUMAN") return reject("DOC_PERMISSION_DENIED", 403);
    try {
      return await this.source.transaction(async (manager) => {
        const identities = (await manager.query(
          "SELECT id FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
          [loadEnvironment().identityIssuer, persona.subject],
        )) as { id: string }[];
        if (!identities[0]) return reject("DOC_IDENTITY_REQUIRED", 403);
        const target = { kind: "PROJECT" as const, ...scope };
        const access = await currentAuthority(manager, target, identities[0].id, permission);
        if (
          !defaultClassificationCatalog.permits(
            defaultClassificationCatalog.reference(access.classificationCeiling),
            defaultClassificationCatalog.reference(access.classification),
          )
        )
          return reject("DOC_CLASSIFICATION_DENIED", 403);
        const projects = (await manager.query(
          "SELECT p.id FROM projects p WHERE p.id=$1 AND p.workspace_id=$2 AND p.state='ACTIVE' AND EXISTS(SELECT 1 FROM workspace_work_types t WHERE t.workspace_id=p.workspace_id AND t.work_type_key='tech-writing.service-documentation' AND t.intake_state='ENABLED')",
          [scope.projectId, scope.workspaceId],
        )) as unknown[];
        if (!projects.length) return reject("DOC_SCOPE_DENIED", 403);
        const permissions: string[] = [];
        for (const candidate of new Set(
          workspaceRoleCatalog
            .flatMap((role) => role.permissions)
            .filter((p) => p.startsWith("docs.")),
        )) {
          try {
            await currentAuthority(manager, target, identities[0].id, candidate);
            permissions.push(candidate);
          } catch (error) {
            if (!(error instanceof HttpException && error.getStatus() === 403)) throw error;
          }
        }
        return work(manager, { ...access, permissions, label: persona.label });
      });
    } catch (error) {
      if (error instanceof DocumentError)
        throw new HttpException({ code: error.code }, error.status);
      if (error instanceof HttpException) throw error;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (["23505", "40001", "40P01"].includes(String(code)))
        return reject("DOC_VERSION_CONFLICT", 409);
      throw error;
    }
  }
  async list(request: LocalSessionRequest, scope: Scope) {
    return this.transaction(request, scope, "docs.read", async (manager, access) => {
      const rows = (await manager.query(
        "SELECT snapshot FROM tech_writing_documents WHERE workspace_id=$1 AND project_id=$2 AND ($3::boolean OR author_id=$4) ORDER BY snapshot->>'updatedAt' DESC,id LIMIT 100",
        [
          scope.workspaceId,
          scope.projectId,
          access.permissions.includes("docs.review"),
          access.actor.principalId,
        ],
      )) as { snapshot: ServiceDocument }[];
      return { documents: rows.map((r) => r.snapshot), permissions: access.permissions };
    });
  }
  private async document(
    manager: EntityManager,
    scope: Scope,
    id: string,
    access: Access,
  ): Promise<ServiceDocument> {
    const rows = (await manager.query(
      "SELECT snapshot FROM tech_writing_documents WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
      [scope.workspaceId, scope.projectId, uuid(id)],
    )) as { snapshot: ServiceDocument }[];
    const doc = rows[0]?.snapshot;
    if (
      !doc ||
      (!access.permissions.includes("docs.review") && doc.author.id !== access.actor.principalId)
    )
      return reject("DOC_NOT_FOUND", 404);
    return doc;
  }
  private async detail(
    manager: EntityManager,
    doc: ServiceDocument,
    access: Access,
  ): Promise<DocumentDetail> {
    const rows = (await manager.query(
      "SELECT entry FROM tech_writing_history WHERE workspace_id=$1 AND project_id=$2 AND document_id=$3 ORDER BY resource_version",
      [doc.workspaceId, doc.projectId, doc.id],
    )) as { entry: DocumentHistory }[];
    return {
      document: doc,
      history: rows.map((r) => r.entry),
      actions: documentActions(doc, access.actor.principalId, access.permissions),
    };
  }
  async get(request: LocalSessionRequest, scope: Scope, id: string) {
    return this.transaction(request, scope, "docs.read", async (manager, access) =>
      this.detail(manager, await this.document(manager, scope, id, access), access),
    );
  }
  private async record(
    manager: EntityManager,
    doc: ServiceDocument,
    access: Access,
    action: "create" | DocumentAction,
    key: string,
  ): Promise<void> {
    const actor = { id: access.actor.principalId, label: access.label };
    const entry: DocumentHistory = { action, actor, at: doc.updatedAt, document: doc };
    await manager.query(
      "INSERT INTO tech_writing_history(id,workspace_id,project_id,document_id,resource_version,entry,authorization_basis) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        doc.workspaceId,
        doc.projectId,
        doc.id,
        doc.resourceVersion,
        JSON.stringify(entry),
        JSON.stringify(access.basis),
      ],
    );
    const correlationId = randomUUID();
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$6,$7,$7,$8,$9,$10)",
      [
        randomUUID(),
        doc.workspaceId,
        doc.projectId,
        doc.updatedAt,
        access.actor,
        `docs.${action}`,
        correlationId,
        access.basis,
        access.classification,
        {
          documentId: doc.id,
          resourceVersion: doc.resourceVersion,
          revision: doc.revision,
          contentHash: doc.contentHash,
          idempotencyKey: key,
          policyVersion: "tech-writing@1.0.0",
          approval: doc.approval,
        },
      ],
    );
  }
  async create(request: LocalSessionRequest, scope: Scope, raw: unknown, key: string) {
    const input = object(raw, ["title", "goal", "audience"]);
    const body = {
      title: text(input.title, 200),
      goal: text(input.goal, 2000),
      audience: text(input.audience, 2000),
    };
    return this.transaction(request, scope, "docs.create", async (manager, access) =>
      command(
        manager,
        scope,
        access.actor.principalId,
        "docs.command",
        key,
        { action: "create", body },
        async () => {
          const doc = newDocument({
            ...scope,
            ...body,
            id: randomUUID(),
            author: { id: access.actor.principalId, label: access.label },
            at: new Date().toISOString(),
            hash: documentHash(""),
          });
          await manager.query(
            "INSERT INTO tech_writing_documents(id,workspace_id,project_id,author_id,snapshot) VALUES($1,$2,$3,$4,$5)",
            [doc.id, doc.workspaceId, doc.projectId, doc.author.id, JSON.stringify(doc)],
          );
          await this.record(manager, doc, access, "create", key);
          return this.detail(manager, doc, access);
        },
      ),
    );
  }
  async act(
    request: LocalSessionRequest,
    scope: Scope,
    id: string,
    action: DocumentAction,
    raw: unknown,
    key: string,
    ifMatch: string | undefined,
  ) {
    uuid(id);
    const expectedVersion = etag(ifMatch);
    const input = object(
      raw,
      action === "save" ? ["body"] : action === "return" ? ["feedback"] : [],
    );
    if (action === "save" && (typeof input.body !== "string" || input.body.length > 100_000))
      return reject("DOC_BODY_INVALID", 400);
    const body =
      action === "save"
        ? { body: input.body as string }
        : action === "return"
          ? { feedback: text(input.feedback, 4000) }
          : {};
    return this.transaction(request, scope, actionPermission[action], async (manager, access) =>
      command(
        manager,
        scope,
        access.actor.principalId,
        "docs.command",
        key,
        { id, action, body, expectedVersion },
        async () => {
          const current = await this.document(manager, scope, id, access);
          if (
            (action === "save" || action === "submit") &&
            current.author.id !== access.actor.principalId
          )
            return reject("DOC_AUTHOR_REQUIRED", 403);
          const next = changeDocument(current, {
            ...body,
            action,
            expectedVersion,
            actor: { id: access.actor.principalId, label: access.label },
            at: new Date().toISOString(),
            hash: documentHash("body" in body ? body.body : current.body),
          });
          await manager.query(
            "UPDATE tech_writing_documents SET snapshot=$4 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [scope.workspaceId, scope.projectId, id, JSON.stringify(next)],
          );
          await this.record(manager, next, access, action, key);
          return this.detail(manager, next, access);
        },
      ),
    );
  }
}
