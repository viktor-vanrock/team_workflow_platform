import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  type ActorReference,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  type ResourceScope,
} from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";
import {
  localPersonaCatalog,
  PlatformAccessService,
  runOwnerProjectRegistrarLocalSeed,
  runProjectMetadataLocalSeed,
} from "@awp/runtime-composition";

import { QA_DATA_SOURCE } from "../extensions/qa-api-authorization.ts";
import { LocalSessionGuard, type LocalSessionRequest } from "./local-session.guard.ts";

export const LOCAL_PERSONA_DATA_SOURCE = QA_DATA_SOURCE;

export interface LocalPersonaTokenClient {
  issue(
    personaKey: string,
  ): Promise<Readonly<{ access_token: string; token_type: string; expires_in: number }>>;
  stepUp?(
    personaKey: string,
  ): Promise<Readonly<{ access_token: string; token_type: string; expires_in: number }>>;
}

export class HttpsFakeIdpTokenClient implements LocalPersonaTokenClient {
  constructor(private readonly issuer: string) {}
  async issue(
    personaKey: string,
  ): Promise<Readonly<{ access_token: string; token_type: string; expires_in: number }>> {
    return this.exchange(personaKey, "token");
  }
  async stepUp(personaKey: string) {
    return this.exchange(personaKey, "_test/step-up");
  }
  private async exchange(
    personaKey: string,
    path: string,
  ): Promise<Readonly<{ access_token: string; token_type: string; expires_in: number }>> {
    const response = await fetch(`${this.issuer}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personaKey }),
    });
    if (!response.ok) throw new Error(`FAKE_IDP_TOKEN_FAILED:${response.status}`);
    return (await response.json()) as Readonly<{
      access_token: string;
      token_type: string;
      expires_in: number;
    }>;
  }
}

@Injectable()
export class LocalPersonaSessionService {
  constructor(
    @Inject(LOCAL_PERSONA_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(HttpsFakeIdpTokenClient) private readonly tokens: HttpsFakeIdpTokenClient,
  ) {}

  options() {
    return localPersonaCatalog.publicOptions();
  }

  async exchange(personaKey: string, workspaceId?: string) {
    const session = await this.session(personaKey, false, undefined, workspaceId);
    const claimed = await new PlatformAccessService(this.dataSource).claimLocalAdministrator(
      session.persona.principalId,
      process.env.AWP_IDENTITY_ISSUER!,
    );
    if (claimed || session.platformPermissions.includes("platform.workspace-roles.manage")) {
      await runOwnerProjectRegistrarLocalSeed(this.dataSource, process.env.AWP_IDENTITY_ISSUER!);
      await runProjectMetadataLocalSeed(this.dataSource, process.env.AWP_IDENTITY_ISSUER!);
    }
    return claimed ? this.session(personaKey, false, undefined, workspaceId) : session;
  }
  async stepUp(personaKey: string, projectId?: string, workspaceId?: string) {
    return this.session(personaKey, true, projectId, workspaceId);
  }
  async selectProject(personaKey: string, projectId: string) {
    return this.session(personaKey, false, projectId);
  }
  private async session(
    personaKey: string,
    stepUp: boolean,
    projectId?: string,
    workspaceId?: string,
  ) {
    if (process.env.AWP_RUNTIME_PROFILE !== "local")
      throw new Error("LOCAL_PERSONA_EXCHANGE_FORBIDDEN");
    if (!localPersonaCatalog.publicOptions().some(({ key }) => key === personaKey))
      throw new ForbiddenException("LOCAL_PERSONA_NOT_AVAILABLE");
    const configured = localPersonaCatalog.resolve(personaKey);
    return this.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const [principal] = (await manager.query(
        "SELECT id,kind FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
        [process.env.AWP_IDENTITY_ISSUER, configured.subject],
      )) as { id: string; kind: "HUMAN" }[];
      if (!principal) throw new ForbiddenException("LOCAL_PERSONA_NOT_AVAILABLE");
      const workspaces = (await manager.query(
        `SELECT DISTINCT w.id AS "workspaceId",w.key AS "workspaceKey",w.name AS "workspaceName" FROM workspaces w JOIN workspace_memberships m ON m.workspace_id=w.id
        WHERE m.principal_id=$1 AND m.state='ACTIVE' AND w.state='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) ORDER BY w.name`,
        [principal.id],
      )) as { workspaceId: string; workspaceKey: string; workspaceName: string }[];
      let selectedWorkspace = workspaceId
        ? workspaces.find((w) => w.workspaceId === workspaceId)
        : (workspaces.find((w) => w.workspaceKey === configured.workspaceKey) ?? workspaces[0]);
      if (projectId && !workspaceId) {
        const [p] = (await manager.query("SELECT workspace_id FROM projects WHERE id=$1", [
          projectId,
        ])) as { workspace_id: string }[];
        selectedWorkspace = workspaces.find((w) => w.workspaceId === p?.workspace_id);
      }
      if ((workspaceId || projectId) && !selectedWorkspace)
        throw new ForbiddenException(
          projectId ? "LOCAL_PROJECT_NOT_AVAILABLE" : "LOCAL_WORKSPACE_NOT_AVAILABLE",
        );
      const identity = {
        ...principal,
        workspace_id: selectedWorkspace?.workspaceId ?? "",
        workspace_key: selectedWorkspace?.workspaceKey ?? "",
      };
      let platformPermissions: string[] = [];
      try {
        await new PlatformAccessService(this.dataSource).authorizeLocal(
          principal.id,
          "platform.users.read",
          manager,
        );
        platformPermissions = ["platform.users.read", "platform.workspace-roles.manage"];
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "PLATFORM_ACCESS_DENIED") throw error;
      }
      const repository = new TypeOrmScopedAccessRepository(manager);
      const policy = new DenyByDefaultAuthorizationPolicy();
      const at = new Date();
      const actor: ActorReference = {
        kind: "HUMAN",
        principalId: identity.id,
        issuer: process.env.AWP_IDENTITY_ISSUER!,
        subject: configured.subject,
      };
      const allowed = async (scope: ResourceScope, classificationKey: string) => {
        const facts = await repository.authorizationFacts(scope, identity.id, at);
        const classification = defaultClassificationCatalog.reference(classificationKey);
        const decisions = [
          ...new Set(facts.roleAssignments.flatMap((role) => [...role.permissions])),
        ].map((permission) => ({
          permission,
          decision: policy.decide({
            context: { actor, scope, correlationId: "local-session", causationId: "local-session" },
            permission,
            resourceClassification: classification,
            facts,
            at,
          }),
        }));
        const permissions = decisions
          .filter(({ decision }) => decision.allowed)
          .map(({ permission }) => permission);
        const roleIds = new Set(
          decisions.flatMap(
            ({ decision }) =>
              decision.basis?.roleAssignmentRefs.map((reference) => reference.id) ?? [],
          ),
        );
        return {
          permissions,
          roles: [
            ...new Set(
              facts.roleAssignments
                .filter((role) => roleIds.has(role.ref.id))
                .map((role) => role.roleKey),
            ),
          ],
        };
      };
      const workspaceScope = { kind: "WORKSPACE" as const, workspaceId: identity.workspace_id };
      const workspaceGrants = identity.workspace_id
        ? await allowed(workspaceScope, "INTERNAL")
        : { permissions: [], roles: [] };
      const candidates = (await manager.query(
        "SELECT id,key,classification_key FROM projects WHERE workspace_id=$1 AND state='ACTIVE' ORDER BY key",
        [identity.workspace_id || null],
      )) as { id: string; key: string; classification_key: string }[];
      const projects = [];
      for (const candidate of candidates) {
        const grants = await allowed(
          { ...workspaceScope, kind: "PROJECT", projectId: candidate.id },
          candidate.classification_key,
        );
        if (grants.permissions.length)
          projects.push({ projectId: candidate.id, projectKey: candidate.key, grants });
      }
      const selected = projectId
        ? projects.find((project) => project.projectId === projectId)
        : (projects.find((project) => project.projectKey === configured.projectKey) ?? projects[0]);
      if (projectId && !selected) throw new ForbiddenException("LOCAL_PROJECT_NOT_AVAILABLE");
      if (stepUp && !this.tokens.stepUp) throw new Error("LOCAL_STEP_UP_UNAVAILABLE");
      const token = stepUp
        ? await this.tokens.stepUp!(personaKey)
        : await this.tokens.issue(personaKey);
      const [ceiling] = (await manager.query(
        "SELECT c.key FROM project_entitlements e JOIN classification_catalog c ON c.key=e.classification_ceiling_key WHERE e.workspace_id=$1 AND e.principal_id=$2 AND e.effect='ALLOW' AND e.revoked_at IS NULL AND e.valid_from<=clock_timestamp() AND (e.valid_until IS NULL OR e.valid_until>clock_timestamp()) ORDER BY c.rank DESC LIMIT 1",
        [identity.workspace_id || null, identity.id],
      )) as { key: string }[];
      const authorizedWorkspaces = [];
      for (const workspace of workspaces) {
        const grants = await allowed(
          { kind: "WORKSPACE", workspaceId: workspace.workspaceId },
          "INTERNAL",
        );
        authorizedWorkspaces.push({ ...workspace, permissions: grants.permissions });
      }
      return Object.freeze({
        accessToken: token.access_token,
        tokenType: token.token_type,
        expiresIn: token.expires_in,
        persona: {
          key: configured.key,
          label: configured.label,
          principalId: identity.id,
          kind: identity.kind,
        },
        context: {
          workspaceId: identity.workspace_id,
          workspaceKey: identity.workspace_key,
          ...(selected ? { projectId: selected.projectId, projectKey: selected.projectKey } : {}),
        },
        projects: projects.map(({ projectId, projectKey, grants }) => ({
          projectId,
          projectKey,
          permissions: grants.permissions,
        })),
        workspaces: authorizedWorkspaces,
        platformPermissions,
        workspacePermissions: workspaceGrants.permissions,
        grants: {
          roles: [...new Set([...workspaceGrants.roles, ...(selected?.grants.roles ?? [])])],
          permissions: [
            ...new Set([
              ...workspaceGrants.permissions.filter((permission) =>
                [
                  "project.register",
                  "project.request.create",
                  "project.catalog.read",
                  "queue.portfolio.read",
                ].includes(permission),
              ),
              ...(projectId
                ? (selected?.grants.permissions ?? [])
                : projects.flatMap((project) => project.grants.permissions)),
            ]),
          ],
          classificationCeiling: ceiling?.key ?? "INTERNAL",
        },
      });
    });
  }
}

@Controller("local")
export class LocalPersonaController {
  constructor(
    @Inject(LocalPersonaSessionService) private readonly sessions: LocalPersonaSessionService,
  ) {}
  @Get("personas") options() {
    return this.sessions.options();
  }
  @Post("persona/exchange") exchange(
    @Body() body: Readonly<{ personaKey?: string; workspaceId?: string }>,
  ) {
    // workspaceId is a requested destination; session() resolves membership and authority from storage.
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.personaKey !== "string" ||
      !body.personaKey ||
      Object.keys(body).some((key) => !["personaKey", "workspaceId"].includes(key))
    )
      throw new BadRequestException("LOCAL_PERSONA_KEY_ONLY");
    if (
      body.workspaceId !== undefined &&
      (typeof body.workspaceId !== "string" || !/^[a-f0-9-]{36}$/iu.test(body.workspaceId))
    )
      throw new BadRequestException("LOCAL_WORKSPACE_INVALID");
    return this.sessions.exchange(body.personaKey, body.workspaceId);
  }
  @Post("persona/projects/:projectId")
  @UseGuards(LocalSessionGuard)
  selectProject(
    @Req() request: LocalSessionRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(projectId)
    )
      throw new BadRequestException("LOCAL_PROJECT_SELECTOR_REQUIRED");
    return this.sessions.selectProject(request.localPersonaKey!, projectId);
  }
  @Post("persona/step-up")
  @UseGuards(LocalSessionGuard)
  stepUp(@Req() request: LocalSessionRequest, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
      throw new BadRequestException("LOCAL_STEP_UP_BODY_MUST_BE_EMPTY");
    const projectId = request.headers["x-awp-project-id"];
    return this.sessions.stepUp(
      request.localPersonaKey!,
      typeof projectId === "string" ? projectId : undefined,
      typeof request.headers["x-awp-workspace-id"] === "string"
        ? request.headers["x-awp-workspace-id"]
        : undefined,
    );
  }
}
