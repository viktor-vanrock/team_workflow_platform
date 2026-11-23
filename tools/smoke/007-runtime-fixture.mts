import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  createRuntimeDataSource,
  loadEnvironment,
  localPersonaCatalog,
  localPersonaIds,
  localSeedIds,
} from "../../packages/runtime-composition/src/index.ts";
import { seedEvidenceHttpProject } from "../../tests/support/007-evidence-http-fixture.ts";

// This command prepares controlled starting evidence and IAM roles, never the HTTP/worker results.
if (
  process.env.AWP_RUNTIME_PROFILE !== "local" ||
  !/^awp-local-007-smoke-[a-z0-9]+-[0-9]+$/u.test(process.env.AWP_007_SMOKE_PROJECT ?? "")
)
  throw new Error("SMOKE_FIXTURE_LOCAL_SCOPE_REQUIRED");
const [workspaceId, projectId] = process.argv.slice(2);
if (
  !workspaceId ||
  !projectId ||
  ![workspaceId, projectId].every((v) => /^[a-f0-9-]{36}$/iu.test(v))
)
  throw new Error("SMOKE_FIXTURE_SCOPE_INVALID");
const source = createRuntimeDataSource(loadEnvironment());
await source.initialize();
try {
  const projects = (await source.query(
    "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 AND key='SMOKE007'",
    [workspaceId, projectId],
  )) as unknown[];
  if (projects.length !== 1) throw new Error("SMOKE_FIXTURE_PROJECT_REQUIRED");
  for (const personaKey of ["owner.local", "integration-admin.alpha", "lead.alpha"] as const) {
    const persona = localPersonaCatalog.resolve(personaKey);
    await source.query(
      "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,$5,'ALLOW',$6,now())",
      [
        randomUUID(),
        workspaceId,
        projectId,
        localPersonaIds[personaKey],
        persona.roles[0],
        JSON.stringify(persona.permissions),
      ],
    );
  }
  const workItemId = randomUUID();
  await source.query(
    "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'ACTIVE','INTERNAL',now())",
    [workItemId, workspaceId, projectId, localSeedIds.workType, localPersonaIds["owner.local"]],
  );
  const proof = await seedEvidenceHttpProject(
    source,
    resolve("apps/api/.local/evidence-public-keys"),
    { workspaceId, projectId },
    workItemId,
    "INTERNAL",
  );
  console.log(
    JSON.stringify({
      workspaceId,
      projectId,
      workItemId,
      manifestId: proof.manifest.manifestId,
      manifestHash: proof.manifest.contentHash,
      packageId: proof.evidencePackage.packageId,
      packageHash: proof.evidencePackage.contentHash,
    }),
  );
} finally {
  await source.destroy();
}
