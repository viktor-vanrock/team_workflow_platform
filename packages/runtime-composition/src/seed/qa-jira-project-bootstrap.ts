import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  publishQaProjectContext,
  publishQaRiskReviewPolicy,
  type QaHumanActor,
  type QaProjectContext,
} from "@awp/competency-qa/node";
import { pilotContentHash } from "@awp/platform-core";

import { localSeedIds } from "./local-seed.ts";
import { qaJiraLocalSeedRefs } from "./qa-jira-local-seed.ts";
import { qaLocalSeedIds } from "./qa-local-seed.ts";

type Document = Record<string, unknown>;
type Kind = "connection" | "mapping" | "profile" | "sourceMapping" | "sourceProfile" | "binding";
type Ref = Readonly<{ id: string; version: 1; contentHash: string }>;
const tables = {
  connection: ["connection_headers", "connection_revisions"],
  mapping: ["connector_mapping_headers", "connector_mapping_revisions"],
  profile: ["connector_profile_headers", "connector_profile_revisions"],
  sourceMapping: ["connector_mapping_headers", "connector_mapping_revisions"],
  sourceProfile: ["connector_profile_headers", "connector_profile_revisions"],
  binding: ["project_integration_binding_headers", "project_integration_binding_revisions"],
} as const;

function stableId(value: string): string {
  const s = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  s[12] = "4";
  s[16] = ((parseInt(s[16]!, 16) & 3) | 8).toString(16);
  return `${s.slice(0, 8).join("")}-${s.slice(8, 12).join("")}-${s.slice(12, 16).join("")}-${s.slice(16, 20).join("")}-${s.slice(20).join("")}`;
}

async function template(
  manager: EntityManager,
  kind: Kind,
  workspaceId: string,
): Promise<Document> {
  const [headers, revisions] = tables[kind];
  const target = qaJiraLocalSeedRefs[kind === "binding" ? "binding" : kind];
  const [row] = (await manager.query(
    `SELECT r.content FROM ${headers} h JOIN ${revisions} r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
    [workspaceId, target.id, target.version],
  )) as { content: Document }[];
  if (!row) throw new Error(`JIRA_BOOTSTRAP_ALPHA_${kind.toUpperCase()}_REQUIRED`);
  return structuredClone(row.content);
}

/** Explicit development fixture, never called automatically by the normal seed. */
export async function bootstrapQaJiraProject(
  source: DataSource,
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    projectDiscriminator: string;
    authorityScopeKey: string;
  }>,
): Promise<Readonly<Record<Kind, Ref>>> {
  if (
    process.env.AWP_RUNTIME_PROFILE !== "local" &&
    process.env.AWP_SUPERADMIN_ENVIRONMENT !== "dev"
  )
    throw new Error("JIRA_PROJECT_BOOTSTRAP_DEVELOPMENT_ONLY");
  if (input.workspaceId !== localSeedIds.workspaceFunctional)
    throw new Error("JIRA_PROJECT_BOOTSTRAP_ALPHA_WORKSPACE_REQUIRED");
  if (
    !/^[A-Za-z0-9_-]{1,80}$/u.test(input.projectDiscriminator) ||
    !/^[a-z][a-z0-9._:-]{1,100}$/u.test(input.authorityScopeKey) ||
    input.projectDiscriminator === "ALPHA" ||
    input.authorityScopeKey === "qa.alpha"
  )
    throw new Error("JIRA_PROJECT_BOOTSTRAP_SCOPE_INVALID");
  const key = `${input.workspaceId}:${input.projectId}`;
  const suffix = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return source.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `jira-project-bootstrap:${input.workspaceId}`,
    ]);
    const [project] = (await manager.query(
      "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 AND state='ACTIVE'",
      [input.workspaceId, input.projectId],
    )) as { id: string }[];
    if (!project || input.projectId === localSeedIds.alpha)
      throw new Error("JIRA_PROJECT_BOOTSTRAP_PROJECT_INVALID");
    const [onboarding] = (await manager.query(
      "SELECT current_operational_state FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR SHARE",
      [input.workspaceId, input.projectId],
    )) as { current_operational_state: string }[];
    if (!onboarding) throw new Error("JIRA_PROJECT_BOOTSTRAP_ONBOARDING_REQUIRED");
    if (onboarding.current_operational_state !== "ACTIVE")
      throw new Error("JIRA_PROJECT_BOOTSTRAP_PROJECT_SUSPENDED");
    const originals = {} as Record<Kind, Document>;
    for (const kind of Object.keys(tables) as Kind[])
      originals[kind] = await template(manager, kind, input.workspaceId);
    const ids = Object.fromEntries(
      (Object.keys(tables) as Kind[]).map((kind) => [
        kind,
        stableId(`jira-project:${key}:${kind}`),
      ]),
    ) as Record<Kind, string>;
    const conflicts = (await manager.query(
      "SELECT 1 FROM connector_mapping_headers h JOIN connector_mapping_revisions r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version WHERE h.workspace_id=$1 AND h.id<>$2 AND r.status='PUBLISHED' AND (r.content->>'authorityScopeKey'=$3 OR r.content->>'projectDiscriminator'=$4) LIMIT 1",
      [input.workspaceId, ids.mapping, input.authorityScopeKey, input.projectDiscriminator],
    )) as unknown[];
    if (conflicts.length) throw new Error("JIRA_PROJECT_BOOTSTRAP_SCOPE_CONFLICT");
    const refs = {} as Record<Kind, Ref>;
    const create = async (kind: Kind, content: Document) => {
      const [headers, revisions] = tables[kind],
        id = ids[kind],
        revisionId = stableId(`jira-project:${key}:${kind}:1`),
        name = `qa-jira-${suffix}-${kind.toLowerCase()}`;
      const hash = pilotContentHash(content);
      const [existing] = (await manager.query(
        `SELECT r.content_hash,r.status,h.current_published_version FROM ${headers} h JOIN ${revisions} r ON r.header_id=h.id AND r.workspace_id=h.workspace_id WHERE h.id=$1 AND h.workspace_id=$2 AND r.version=1`,
        [id, input.workspaceId],
      )) as { content_hash: string; status: string; current_published_version: number | null }[];
      if (existing) {
        if (
          existing.content_hash !== hash ||
          existing.status !== "PUBLISHED" ||
          existing.current_published_version !== 1
        )
          throw new Error("JIRA_PROJECT_BOOTSTRAP_EXISTING_CONFLICT");
      } else {
        if (kind === "binding") {
          await manager.query(
            `INSERT INTO ${headers}(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,$4,1)`,
            [id, input.workspaceId, input.projectId, name],
          );
          await manager.query(
            `INSERT INTO ${revisions}(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,clock_timestamp())`,
            [revisionId, input.workspaceId, input.projectId, id, JSON.stringify(content), hash],
          );
        } else {
          await manager.query(
            `INSERT INTO ${headers}(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,1)`,
            [id, input.workspaceId, name],
          );
          await manager.query(
            `INSERT INTO ${revisions}(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,clock_timestamp())`,
            [revisionId, input.workspaceId, id, JSON.stringify(content), hash],
          );
        }
        await manager.query(
          "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,$4,$5,1,'VALID',$6,$7,clock_timestamp())",
          [
            randomUUID(),
            input.workspaceId,
            kind === "binding" ? input.projectId : null,
            kind === "sourceMapping"
              ? "MAPPING"
              : kind === "sourceProfile"
                ? "PROFILE"
                : kind.toUpperCase(),
            id,
            hash,
            JSON.stringify({ checks: [{ key: "local-bootstrap-bypass", outcome: "PASS" }] }),
          ],
        );
        await manager.query(
          "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,'jira.local-bootstrap','SUCCEEDED','LOCAL_VALIDATION_BYPASS',$5,$5,NULL,'INTERNAL',$6)",
          [
            randomUUID(),
            input.workspaceId,
            input.projectId,
            JSON.stringify({ kind: "SERVICE", principalId: "jira-local-bootstrap" }),
            randomUUID(),
            JSON.stringify({ kind, id, version: 1, contentHash: hash }),
          ],
        );
      }
      refs[kind] = { id, version: 1, contentHash: hash };
    };
    const connectorRef = { key: "jira.operational-authority", version: "1.0.0" };
    const connection: Document = {
      ...originals.connection,
      connectorRef,
      projectId: "100",
      issueTypeId: "10001",
    };
    delete connection.previousRef;
    await create("connection", connection);
    const mapping: Document = {
      ...originals.mapping,
      connectorRef,
      authorityScopeKey: input.authorityScopeKey,
      projectDiscriminator: input.projectDiscriminator,
    };
    delete mapping.previousRef;
    await create("mapping", mapping);
    const sourceMapping: Document = { ...originals.sourceMapping };
    delete sourceMapping.previousRef;
    await create("sourceMapping", sourceMapping);
    const profile: Document = {
      ...originals.profile,
      connectorRef,
      connectionRef: { id: ids.connection, version: 1 },
      mappingRef: { id: ids.mapping, version: 1 },
    };
    delete profile.previousRef;
    await create("profile", profile);
    const sourceProfile: Document = {
      ...originals.sourceProfile,
      connectionRef: { id: ids.connection, version: 1 },
      mappingRef: { id: ids.sourceMapping, version: 1 },
      capabilityConfigurations: [
        {
          ...(profile.capabilityConfigurations as Document[])[0],
          operations: [
            {
              operation: "request.read",
              effect: "READ",
              idempotencyStrategy: "RECONCILIATION",
              confirmationMode: "READ_BACK",
            },
          ],
        },
      ],
    };
    delete sourceProfile.previousRef;
    await create("sourceProfile", sourceProfile);
    const binding: Document = {
      ...originals.binding,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      entries: (originals.binding.entries as Document[]).map((entry) => ({
        ...entry,
        profileRef: {
          id: entry.logicalRole === "SOURCE_CONTEXT" ? ids.sourceProfile : ids.profile,
          version: 1,
        },
        externalScope: {
          ...(entry.externalScope as Document),
          value: {
            ...((entry.externalScope as Document).value as Document),
            authorityScopeKey: input.authorityScopeKey,
          },
        },
      })),
    };
    delete binding.previousRef;
    await create("binding", binding);
    const [alphaContext] = (await manager.query(
      "SELECT v.content FROM qa_project_contexts h JOIN qa_project_context_versions v ON v.id=h.current_published_version_id AND v.workspace_id=h.workspace_id AND v.project_id=h.project_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.id=$3",
      [input.workspaceId, localSeedIds.alpha, qaLocalSeedIds.context],
    )) as { content: QaProjectContext }[];
    if (!alphaContext) throw new Error("JIRA_PROJECT_BOOTSTRAP_ALPHA_CONTEXT_REQUIRED");
    const contextId = stableId(`jira-project:${key}:context`),
      contextVersionId = stableId(`jira-project:${key}:context:1`),
      policyId = stableId(`jira-project:${key}:risk`),
      policyVersionId = stableId(`jira-project:${key}:risk:1`);
    const actor: QaHumanActor = alphaContext.content.publishedBy;
    const publishedAt = alphaContext.content.publishedAt;
    const policy = publishQaRiskReviewPolicy({
      policyId,
      version: 1,
      scope: input,
      actor,
      publishedAt,
    });
    const {
      schemaVersion: _schemaVersion,
      state: _state,
      contentHash: _contentHash,
      ...alpha
    } = alphaContext.content;
    void _schemaVersion;
    void _state;
    void _contentHash;
    const context = publishQaProjectContext({
      ...alpha,
      contextId,
      version: 1,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      riskReviewPolicyRef: { id: policyId, version: 1, contentHash: policy.contentHash },
    });
    const [existingContext] = (await manager.query(
      "SELECT current_published_version_id,current_published_content_hash FROM qa_project_contexts WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [input.workspaceId, input.projectId, contextId],
    )) as {
      current_published_version_id: string | null;
      current_published_content_hash: string | null;
    }[];
    if (existingContext) {
      if (
        existingContext.current_published_version_id !== contextVersionId ||
        existingContext.current_published_content_hash !== context.contentHash
      )
        throw new Error("JIRA_PROJECT_BOOTSTRAP_CONTEXT_CONFLICT");
    } else {
      await manager.query(
        "INSERT INTO qa_risk_review_policies(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1)",
        [policyId, input.workspaceId, input.projectId],
      );
      await manager.query(
        "INSERT INTO qa_risk_review_policy_versions(id,workspace_id,project_id,header_id,version,content_hash,content,published_by,published_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
        [
          policyVersionId,
          input.workspaceId,
          input.projectId,
          policyId,
          policy.contentHash,
          JSON.stringify(policy),
          JSON.stringify(actor),
          publishedAt,
        ],
      );
      await manager.query(
        "UPDATE qa_risk_review_policies SET current_published_version_id=$1,current_published_version=1,current_published_content_hash=$2,resource_version=2 WHERE id=$3",
        [policyVersionId, policy.contentHash, policyId],
      );
      await manager.query(
        "INSERT INTO qa_project_contexts(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1)",
        [contextId, input.workspaceId, input.projectId],
      );
      await manager.query(
        "INSERT INTO qa_project_context_versions(id,workspace_id,project_id,header_id,version,content_hash,content,published_by,published_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
        [
          contextVersionId,
          input.workspaceId,
          input.projectId,
          contextId,
          context.contentHash,
          JSON.stringify(context),
          JSON.stringify(actor),
          publishedAt,
        ],
      );
      await manager.query(
        "UPDATE qa_project_contexts SET current_published_version_id=$1,current_published_version=1,current_published_content_hash=$2,resource_version=2 WHERE id=$3",
        [contextVersionId, context.contentHash, contextId],
      );
    }
    return Object.freeze(refs);
  });
}
