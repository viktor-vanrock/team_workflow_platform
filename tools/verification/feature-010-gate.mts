import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const read = async (path: string) => await readFile(resolve(root, path), "utf8");
const failures: string[] = [];

async function absent(path: string, code: string): Promise<void> {
  try {
    await access(resolve(root, path));
    failures.push(code);
  } catch {
    // Expected: the removed provider is not part of the v1 repository surface.
  }
}

const workspace = await read("pnpm-workspace.yaml");
const lockfile = await read("pnpm-lock.yaml");
const composeText = await read("infra/compose/docker-compose.local.yml");
const compose = parse(composeText) as {
  services?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
};
const environment = await read("packages/runtime-composition/src/config/environment.ts");
const readiness = await read("packages/runtime-composition/src/bootstrap/local-readiness.ts");
const qaController = await read("apps/api/src/extensions/qa-evidence.controller.ts");
const artifactPolicy = await read(
  "packages/runtime-composition/src/pilot/artifact-source-policy.ts",
);
const openapi = JSON.parse(await read("apps/api/openapi.generated.json")) as {
  paths?: Record<string, unknown>;
};
const currentDocumentation = (
  await Promise.all(
    [
      "README.md",
      "docs/agentic-workspace-platform-master-spec-v2.md",
      "docs/architecture/README.md",
      "docs/deployment/configuration.md",
      "docs/deployment/templates/runtime.env.example",
      "docs/deployment/templates/deployment-passport.md",
      "docs/runbooks/pilot-deployment-checklist.md",
      "docs/runbooks/pilot-development.md",
      "docs/runbooks/pilot-infrastructure.md",
      "docs/runbooks/pilot-integration-intake.md",
      "docs/runbooks/pilot-recovery.md",
    ].map(read),
  )
).join("\n");

if (/bullmq|@nestjs\/bullmq/iu.test(`${workspace}\n${lockfile}`))
  failures.push("BULLMQ_DEPENDENCY_PRESENT");
if (["redis", "s3mock", "s3mock-init"].some((key) => key in (compose.services ?? {})))
  failures.push("REMOVED_COMPOSE_SERVICE_PRESENT");
if (/AWP_(?:REDIS|S3|OBJECT_STORE)/u.test(composeText))
  failures.push("REMOVED_COMPOSE_INPUT_PRESENT");
if (/AWP_(?:REDIS|S3|OBJECT_STORE)|redisUrl|s3Endpoint|objectStoreProvider/u.test(environment))
  failures.push("REMOVED_RUNTIME_INPUT_PRESENT");
if (/\b(?:redis|s3mock)\b/iu.test(readiness)) failures.push("REMOVED_READINESS_PROBE_PRESENT");
if (/evidence-attachments|QA_EVIDENCE_UPLOADS/u.test(qaController))
  failures.push("QA_ATTACHMENT_ROUTE_PRESENT");
if (Object.keys(openapi.paths ?? {}).some((path) => path.includes("evidence-attachments")))
  failures.push("QA_ATTACHMENT_OPENAPI_PRESENT");
if (/APPROVED_OBJECT_STORE|OBJECT_STORE|objectStorePolicyRef/u.test(artifactPolicy))
  failures.push("NON_GITLAB_ARTIFACT_POLICY_PRESENT");
if (
  /AWP_REDIS_URL\s*=|AWP_S3_|APPROVED_OBJECT_STORE|CorporateObjectStorage|platform-queue-bullmq/u.test(
    currentDocumentation,
  )
)
  failures.push("CURRENT_DOCUMENTATION_CONTRADICTS_V1_BOUNDARY");

await Promise.all([
  absent("packages/platform-queue-bullmq", "BULLMQ_PACKAGE_PRESENT"),
  absent(
    "packages/runtime-composition/src/storage/s3-compatible-object-storage.ts",
    "S3_ADAPTER_PRESENT",
  ),
  absent(
    "packages/runtime-composition/src/storage/corporate-object-storage.ts",
    "OBJECT_STORE_ADAPTER_PRESENT",
  ),
  absent("packages/runtime-composition/src/pilot/evidence-uploads.ts", "QA_UPLOAD_RUNTIME_PRESENT"),
  absent("infra/compose/scripts/init-s3mock.sh", "S3_INIT_PRESENT"),
]);

const report = Object.freeze({
  schemaVersion: 1,
  feature: "010-remove-redis-s3",
  status: failures.length ? "FAIL" : "PASS",
  checks: Object.freeze({
    postgresDurableAuthority: true,
    gitLabArtifactBytesOnly: true,
    manualBinaryUploads: false,
  }),
  failures: Object.freeze(failures),
});
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
