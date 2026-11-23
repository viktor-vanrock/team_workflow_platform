import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ComposeSmokeRuntime, freePort, hash, workspace } from "./007-compose-runtime.mts";
import { OnboardingSmokeJourney } from "./007-http-journey.mts";

const unknown = process.argv.slice(2).filter((v) => !["--", "--plan"].includes(v));
if (unknown.length) throw new Error(`SMOKE_ARGUMENT_UNKNOWN:${unknown.join(",")}`);
const services = ["postgres", "mock-hub", "worker", "api", "web"];
if (process.argv.includes("--plan")) {
  console.log(
    "Unique awp-local-007-smoke-* Compose project; internal network and ephemeral host ports; image build, migrations and seed.",
  );
  console.log(
    "Real API registration/entitlements; ordinary session denied then explicit development step-up; controlled signed evidence input.",
  );
  console.log(
    "Stop worker; HTTP queues Jira command; verify zero provider effects; start worker; confirm one effect and one Work Item.",
  );
  console.log(
    "HTTP suspend; drain and redeliver persisted onboarding events; verify stable inbox receipts.",
  );
  console.log(
    `Restart ${services.join(", ")}; verify new process start times, durable business state, signature/export and idempotent replay.`,
  );
  console.log(
    "Run Chromium against live web/API, verify/download evidence, inspect exact audit counts; remove only owned containers, networks and volumes.",
  );
  process.exit(0);
}
const projectName = `awp-local-007-smoke-${Date.now().toString(36)}-${process.pid}`;
const ports = await Promise.all(Array.from({ length: 5 }, freePort));
assert.equal(new Set(ports).size, 5);
const [api, worker, mock, idp, web] = ports;
const environment = {
  ...process.env,
  CI: "true",
  AWP_LOCAL_PROJECT_NAME: projectName,
  AWP_ENVIRONMENT: "LOCAL",
  AWP_RUNTIME_PROFILE: "local",
  AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
  AWP_EXTERNAL_NETWORK_MODE: "deny",
  AWP_QUEUE_STATIC_CONTOUR: "true",
  AWP_ONBOARDING_STATIC_CONTOUR: "true",
  AWP_EVIDENCE_SIGNER: "local-ed25519",
  AWP_EVIDENCE_SIGNER_KID: "local-ed25519:1",
  AWP_EVIDENCE_SIGNER_PRIVATE_MATERIAL: "true",
  AWP_API_HOST_PORT: String(api),
  AWP_WORKER_HOST_PORT: String(worker),
  AWP_MOCK_HUB_HOST_PORT: String(mock),
  AWP_IDP_HOST_PORT: String(idp),
  AWP_WEB_HOST_PORT: String(web),
  AWP_API_URL: `http://127.0.0.1:${api}`,
  AWP_WORKER_URL: `http://127.0.0.1:${worker}`,
  AWP_MOCK_HUB_URL: `http://127.0.0.1:${mock}`,
  AWP_WEB_URL: `http://127.0.0.1:${web}`,
  AWP_WEB_ORIGIN: `http://127.0.0.1:${web}`,
  AWP_PUBLIC_API_URL: `http://127.0.0.1:${api}`,
};
const runtime = new ComposeSmokeRuntime(projectName, environment),
  journey = new OnboardingSmokeJourney(runtime),
  startedAt = new Date().toISOString();
const stages: { id: string; status: "PASS" | "FAIL"; durationMs: number; details?: unknown }[] = [];
const restarts: unknown[] = [];
let failure: string | undefined,
  cleanShutdown = false,
  cleanup: unknown;
async function stage(id: string, work: () => Promise<unknown>) {
  const started = Date.now();
  console.log(`[smoke:007] ${id}`);
  try {
    const details = await work();
    stages.push({ id, status: "PASS", durationMs: Date.now() - started, details });
    return details;
  } catch (error) {
    stages.push({ id, status: "FAIL", durationMs: Date.now() - started });
    throw error;
  }
}
const sourcePaths = [
  "packages/runtime-composition/src/onboarding/worker.ts",
  "tests/unit/007/onboarding-event-worker.spec.ts",
  "tools/local/onboarding-cli.mts",
  "packages/runtime-composition/src/pilot/development-seed.ts",
  "packages/runtime-composition/src/cli/seed.ts",
  "tests/integration/007/local-project-bootstrap.spec.ts",
  ".dockerignore",
  ".gitlab-ci.yml",
  "package.json",
  "pnpm-lock.yaml",
  "tests/browser-test-files.ts",
  "tests/integration/fake-idp-oidc.spec.ts",
  "tools/smoke/feature-007.mts",
  "tools/smoke/feature-007-browser-process.mts",
  "tools/smoke/007-compose-runtime.mts",
  "tools/smoke/007-http-journey.mts",
  "tools/smoke/007-runtime-fixture.mts",
  "tests/e2e/007/compose-live.spec.ts",
  "tests/support/007-evidence-http-fixture.ts",
  "apps/api/src/local/local-persona.controller.ts",
  "apps/fake-idp/src/oidc.controller.ts",
  "apps/worker/src/app.module.ts",
  "apps/web/src/App.tsx",
  "infra/compose/docker-compose.local.yml",
  "infra/compose/docker/node-runtime.Dockerfile",
];
const files = sourcePaths.map((path) => ({
  path,
  sha256: hash(readFileSync(resolve(workspace, path))),
}));
try {
  await stage("isolated-compose-up", async () => {
    await runtime.run("local-up", process.execPath, ["tools/local/onboarding-cli.mts", "up"]);
    for (const s of services) await runtime.ready(s);
    const identities = await Promise.all(
      services.map(async (service) => ({ service, ...(await runtime.identity(service)) })),
    );
    assert.equal(new Set(identities.map((v) => v.Pid)).size, services.length);
    assert.ok(identities.every((v) => v.Pid > 0));
    const image = await runtime.run("runtime-image", "docker", [
      "image",
      "inspect",
      "awp-local-node:24.20.0",
      "--format",
      "{{.Id}}",
    ]);
    return { projectName, ports, identities, image };
  });
  await stage("onboarding-evidence-http", () => journey.prepare());
  await stage("independent-worker-effect", () => journey.queueWorkerEffect());
  await stage("suspension-event-replay", () => journey.suspendAndDrainEvents());
  await stage("service-restarts", async () => {
    for (const service of services) {
      const before = await runtime.identity(service);
      await runtime.compose(`restart-${service}`, ["restart", service]);
      await runtime.ready(service);
      const after = await runtime.identity(service);
      assert.notEqual(after.StartedAt, before.StartedAt);
      assert.ok(after.Pid > 0);
      restarts.push({ service, before, after });
    }
    for (const s of ["api", "worker", "mock-hub", "web"]) await runtime.ready(s);
    return restarts;
  });
  await stage("post-restart-replay-and-signature", () => journey.afterRestart());
  await stage("durable-cli-status", async () => {
    const status = await runtime.run("onboarding-status", process.execPath, [
      "tools/local/onboarding-cli.mts",
      "status",
    ]);
    assert.ok(
      status
        .split("\n")
        .some(
          (line) =>
            line.includes(`onboarding.project=${journey.proof.projectId} `) &&
            line.includes("state=SUSPENDED"),
        ),
    );
    return { projectId: journey.proof.projectId, state: "SUSPENDED" };
  });
  await stage("live-browser", async () => {
    const input = resolve(runtime.directory, "browser-input.json");
    writeFileSync(input, JSON.stringify({ projectName, ...journey.proof }));
    runtime.environment.AWP_007_SMOKE_INPUT = input;
    await runtime.run("browser-child", process.execPath, [
      "tools/smoke/feature-007-browser-process.mts",
      "--existing",
    ]);
    const result = await runtime.sql<{ exports: number; audits: number }>(
      "browser-export-count",
      `SELECT json_build_object('exports',(SELECT count(*)::int FROM evidence_export_records WHERE project_id='${journey.proof.projectId}'::uuid),'audits',(SELECT count(*)::int FROM audit_events WHERE project_id='${journey.proof.projectId}'::uuid AND action='qa.evidence.export'));`,
    );
    assert.deepEqual(result, { exports: 2, audits: 2 });
    return result;
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(failure);
  try {
    await runtime.compose("failure-container-logs", ["logs", "--no-color", "--tail", "120"], 30000);
  } catch {
    // Failure diagnostics are best-effort and must not hide the original error.
  }
} finally {
  try {
    cleanup = await runtime.cleanup();
    cleanShutdown = true;
    stages.push({ id: "clean-shutdown", status: "PASS", durationMs: 0, details: cleanup });
  } catch (error) {
    failure ??= String(error);
    stages.push({ id: "clean-shutdown", status: "FAIL", durationMs: 0 });
  }
}
if (files.some((file) => hash(readFileSync(resolve(workspace, file.path))) !== file.sha256))
  failure ??= "SMOKE_SOURCE_CHANGED_DURING_RUN";
const status = failure || !cleanShutdown ? "FAIL" : "PASS";
const report = {
  schemaVersion: 1,
  feature: "007-project-onboarding-evidence-security",
  checkpoint: "SMOKE",
  status,
  startedAt,
  finishedAt: new Date().toISOString(),
  isolatedProjectName: projectName,
  contour: environment.AWP_COMPOSITION,
  production: "DENIED",
  externalNetwork: "DENIED",
  deterministicEffectCounts: status === "PASS",
  signingVerification: stages.some(
    (s) => s.id === "post-restart-replay-and-signature" && s.status === "PASS",
  ),
  restarts,
  cleanShutdown,
  stages,
  sourceBinding: { files, aggregateSha256: hash(JSON.stringify(files)) },
  logs: runtime.directory.replace(`${workspace}/`, ""),
  limits: [
    "Controlled starting IAM roles and signed evidence; local Fake IdP step-up is not corporate MFA.",
    "Jira effects target only the isolated Mock Hub; this does not satisfy corporate N2/pilot acceptance.",
  ],
  ...(failure ? { failure } : {}),
};
const destination = resolve(
  workspace,
  "reports/007-project-onboarding-evidence-security/smoke.json",
);
mkdirSync(resolve(destination, ".."), { recursive: true });
writeFileSync(`${destination}.tmp`, JSON.stringify(report, null, 2) + "\n");
renameSync(`${destination}.tmp`, destination);
writeFileSync(resolve(runtime.directory, "result.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`[smoke:007] ${status}: ${destination}`);
if (status !== "PASS") process.exitCode = 1;
