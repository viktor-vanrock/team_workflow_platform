import { spawnSync } from "node:child_process";

const apiUrl = process.env.AWP_API_URL ?? "http://127.0.0.1:3000";
const webUrl = process.env.AWP_WEB_URL ?? "http://127.0.0.1:5173";
const compose = [
  "compose",
  "--project-name",
  process.env.AWP_LOCAL_PROJECT_NAME?.trim() || "awp-local",
  "--file",
  "infra/compose/docker-compose.local.yml",
] as const;
const results: Array<{ check: string; result: "PASS" | "FAIL"; detail: string }> = [];

async function check(name: string, action: () => Promise<string>): Promise<void> {
  try {
    results.push({ check: name, result: "PASS", detail: await action() });
  } catch (error) {
    results.push({
      check: name,
      result: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${apiUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function session(personaKey: string): Promise<string> {
  const value = await json<{ accessToken: string }>("/local/persona/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaKey }),
  });
  return value.accessToken;
}

function authorized(token: string, body?: unknown): RequestInit {
  return {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  };
}

function containerProbe(service: "api" | "worker", code: string): void {
  const run = spawnSync("docker", [...compose, "exec", "-T", service, "node", "-e", code], {
    encoding: "utf8",
  });
  if (run.status !== 0)
    throw new Error(
      `${service}: ${(run.stderr || run.stdout).trim() || `exit ${String(run.status)}`}`,
    );
}

let requester = "";
let executor = "";
let owner = "";
let directCorrelation = "";
const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

try {
  await check("API dependency readiness", async () => {
    const value = await json<{
      status: string;
      runtime: { profile: string };
      dependencies: Record<string, { state: string }>;
    }>("/health/ready");
    if (value.status !== "UP" || value.runtime.profile !== "local")
      throw new Error(`unexpected report ${JSON.stringify(value)}`);
    const down = Object.entries(value.dependencies).filter(
      ([, dependency]) => dependency.state !== "UP",
    );
    if (down.length > 0) throw new Error(`dependencies not UP: ${JSON.stringify(down)}`);
    return `profile=local; ${Object.keys(value.dependencies).join(",")}=UP`;
  });

  await check("Worker and web readiness", async () => {
    const worker = await fetch("http://127.0.0.1:3010/health/ready", {
      signal: AbortSignal.timeout(10_000),
    });
    const web = await fetch(webUrl, { signal: AbortSignal.timeout(10_000) });
    if (!worker.ok || !web.ok) throw new Error(`worker=${worker.status}; web=${web.status}`);
    const report = (await worker.json()) as { status: string; runtime: { profile: string } };
    if (report.status !== "UP" || report.runtime.profile !== "local")
      throw new Error(JSON.stringify(report));
    return "worker=UP; web=UP; profile=local";
  });

  await check("Deterministic local identity", async () => {
    const response = await fetch("http://127.0.0.1:4010/mock/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: 42 }),
    });
    if (!response.ok) throw new Error(`Mock Hub seed HTTP ${response.status}`);
    [requester, executor, owner] = await Promise.all([
      session("requester.alpha"),
      session("executor.alpha"),
      session("owner.local"),
    ]);
    return "three backend-issued ES256 sessions";
  });

  await check("Dummy intake", async () => {
    const value = await json<{ id: string; state: string }>(
      "/local/walking-skeleton/dummy",
      authorized(requester, { sampleName: `Smoke ${unique}`, message: "Feature 001 smoke" }),
    );
    if (value.state !== "OPEN" || !value.id) throw new Error(JSON.stringify(value));
    return `workItem=${value.id}`;
  });

  await check("Connector effect exactly once", async () => {
    const input = {
      recordKey: `smoke-direct-${unique}`,
      message: "one external effect",
      clientRequestKey: `smoke-direct-${unique}`,
      approvalRequired: false,
    };
    const first = await json<{
      id: string;
      state: string;
      effectCount: number;
      correlationId: string;
    }>("/local/walking-skeleton/commands", authorized(executor, input));
    const replay = await json<{ id: string; effectCount: number; replayed: boolean }>(
      "/local/walking-skeleton/commands",
      authorized(executor, input),
    );
    if (
      first.state !== "CONFIRMED" ||
      first.effectCount !== 1 ||
      replay.id !== first.id ||
      replay.effectCount !== 1 ||
      !replay.replayed
    )
      throw new Error(JSON.stringify({ first, replay }));
    directCorrelation = first.correlationId;
    return `effectCount=1; replayed=true; correlation=${directCorrelation}`;
  });

  await check("Optional Approval", async () => {
    const awaiting = await json<{ approvalId: string; state: string; effectCount: number }>(
      "/local/walking-skeleton/commands",
      authorized(executor, {
        recordKey: `smoke-approved-${unique}`,
        message: "approved effect",
        clientRequestKey: `smoke-approved-${unique}`,
        approvalRequired: true,
      }),
    );
    if (awaiting.state !== "AWAITING_APPROVAL" || awaiting.effectCount !== 0)
      throw new Error(JSON.stringify(awaiting));
    const approved = await json<{ state: string; effectCount: number }>(
      `/local/walking-skeleton/approvals/${awaiting.approvalId}/approve`,
      authorized(owner, {}),
    );
    if (approved.state !== "CONFIRMED" || approved.effectCount !== 1)
      throw new Error(JSON.stringify(approved));
    return `approval=${awaiting.approvalId}; effectCount=1`;
  });

  await check("Correlation trace", async () => {
    const overview = await json<{
      commands: readonly Record<string, unknown>[];
      artifacts: readonly Record<string, unknown>[];
    }>("/local/walking-skeleton", authorized(executor));
    if (
      !overview.commands.some(
        (command) => command.correlation_id === directCorrelation && command.state === "CONFIRMED",
      )
    )
      throw new Error(`correlation ${directCorrelation} not projected`);
    if (overview.artifacts.length !== 0)
      throw new Error("local object artifacts must not be seeded in v1");
    return `command correlation=${directCorrelation}; localArtifacts=0`;
  });

  await check("Physical egress barrier", async () => {
    const internal =
      "fetch('http://mock-hub:4010/health/live',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";
    const denied =
      "fetch('https://example.com',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(1)).catch(()=>process.exit(0))";
    for (const service of ["api", "worker"] as const) {
      containerProbe(service, internal);
      containerProbe(service, denied);
    }
    return "api/worker→Mock Hub allowed; public HTTPS denied";
  });
} catch {
  process.exitCode = 1;
}

console.table(results);
if (results.some((result) => result.result === "FAIL")) process.exitCode = 1;
