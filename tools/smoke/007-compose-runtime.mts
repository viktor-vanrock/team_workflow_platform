import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

export const workspace = resolve(import.meta.dirname, "../..");
export const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
export const hash = (value: string | Buffer) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export function uuidSql(value: unknown) {
  const id = String(value);
  if (!/^[a-f0-9-]{36}$/iu.test(id)) throw new Error("SMOKE_UUID_INVALID");
  return `'${id}'::uuid`;
}
export async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 90000,
): Promise<T> {
  const until = Date.now() + timeout;
  let last: unknown;
  do {
    try {
      const value = await read();
      if (accept(value)) return value;
      last = value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => {
      setTimeout(r, 500);
    });
  } while (Date.now() < until);
  throw new Error(`${label}_TIMEOUT:${JSON.stringify(last)}`);
}
export async function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      if (!address || typeof address === "string") {
        s.close(() => reject(new Error("SMOKE_PORT_MISSING")));
        return;
      }
      s.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}

export class ComposeSmokeRuntime {
  readonly directory: string;
  readonly projectName: string;
  readonly environment: NodeJS.ProcessEnv;
  constructor(projectName: string, environment: NodeJS.ProcessEnv) {
    this.projectName = projectName;
    this.environment = environment;
    if (!/^awp-local-007-smoke-[a-z0-9]+-[0-9]+$/u.test(projectName))
      throw new Error("SMOKE_PROJECT_SCOPE_INVALID");
    this.directory = resolve(workspace, "reports/project/compose-smoke-007", projectName);
    mkdirSync(this.directory, { recursive: true });
  }
  async run(label: string, executable: string, args: readonly string[], timeout = 900000) {
    const file = resolve(this.directory, `${label}.log`);
    return await new Promise<string>((done, reject) => {
      const child = spawn(executable, [...args], {
        cwd: workspace,
        env: this.environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        finished = false;
      const capture = (chunk: Buffer) => {
        appendFileSync(file, chunk);
        output = (output + chunk.toString()).slice(-16 * 1024 * 1024);
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!finished) child.kill("SIGKILL");
        }, 5000).unref();
      }, timeout);
      child.once("error", (error) => {
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        finished = true;
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`${label}_FAILED:${code ?? signal}; log=${file}`));
        else done(output.trim());
      });
    });
  }
  compose(label: string, args: readonly string[], timeout?: number) {
    return this.run(
      label,
      "docker",
      ["compose", "--project-name", this.projectName, "--file", composeFile, ...args],
      timeout,
    );
  }
  async sql<T>(label: string, statement: string, database = "awp"): Promise<T> {
    return JSON.parse(
      await this.compose(
        label,
        [
          "exec",
          "-T",
          "postgres",
          "psql",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "awp_bootstrap",
          "-d",
          database,
          "-At",
          "-c",
          statement,
        ],
        30000,
      ),
    ) as T;
  }
  async ready(service: string) {
    const endpoint: Record<string, string> = {
      api: `${this.environment.AWP_API_URL}/health/ready`,
      worker: `${this.environment.AWP_WORKER_URL}/health/ready`,
      "mock-hub": `${this.environment.AWP_MOCK_HUB_URL}/health/live`,
      web: this.environment.AWP_WEB_URL!,
    };
    if (endpoint[service])
      await waitFor(
        `${service}_READY`,
        () => fetch(endpoint[service]!, { signal: AbortSignal.timeout(5000) }),
        (r) => r.ok,
      );
    else
      await waitFor(
        `${service}_HEALTHY`,
        async () => {
          const parsed = JSON.parse(
            await this.compose(`health-${service}`, ["ps", "--format", "json", service]),
          ) as { Health?: string; State: string } | { Health?: string; State: string }[];
          return Array.isArray(parsed) ? parsed[0] : parsed;
        },
        (r) => r?.Health === "healthy",
      );
  }
  async identity(service: string) {
    const id = (await this.compose(`id-${service}`, ["ps", "-q", service])).trim();
    if (!/^[a-f0-9]+$/u.test(id)) throw new Error(`SMOKE_CONTAINER_MISSING:${service}`);
    return JSON.parse(
      await this.run(`inspect-${service}`, "docker", [
        "inspect",
        "--format",
        "{{json .State}}",
        id,
      ]),
    ) as { Pid: number; StartedAt: string; Status: string };
  }
  async cleanup() {
    await this.compose("cleanup", ["down", "--volumes", "--remove-orphans"], 120000);
    const containers = await this.run("remaining-containers", "docker", [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${this.projectName}`,
    ]);
    const volumes = await this.run("remaining-volumes", "docker", [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${this.projectName}`,
    ]);
    const networks = await this.run("remaining-networks", "docker", [
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${this.projectName}`,
    ]);
    if (containers || volumes || networks) throw new Error("SMOKE_CLEANUP_INCOMPLETE");
    return { containers: 0, volumes: 0, networks: 0 };
  }
}
