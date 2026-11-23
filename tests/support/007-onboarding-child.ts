import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function startOnboardingProcess(
  databaseUrl: string,
  providerUrl: string,
  role: "api" | "worker",
) {
  const child = fork(fileURLToPath(new URL("./007-onboarding-process.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      AWP_JOURNEY_DATABASE_URL: databaseUrl,
      AWP_JOURNEY_PROVIDER_URL: providerUrl,
      AWP_JOURNEY_ROLE: role,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.resume();
  let sequence = 0,
    output = "";
  child.stderr?.on("data", (value: Buffer) => {
    output = (output + value.toString()).slice(-5000);
  });
  const pending = new Map<
    number,
    {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let origin = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`JOURNEY_WORKER_START_TIMEOUT:${output}`));
    }, 30_000);
    child.on(
      "message",
      (message: {
        ready?: boolean;
        origin?: string;
        id?: number;
        result?: Record<string, unknown>;
        error?: string;
      }) => {
        if (message.ready) {
          origin = message.origin ?? "";
          clearTimeout(timer);
          resolve();
          return;
        }
        const entry = pending.get(message.id!);
        if (!entry) return;
        pending.delete(message.id!);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error));
        else entry.resolve(message.result!);
      },
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`JOURNEY_WORKER_EXIT:${code}:${output}`));
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`JOURNEY_WORKER_EXIT:${code}:${output}`));
      }
      pending.clear();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const send = (operation: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("JOURNEY_WORKER_REQUEST_TIMEOUT"));
      }, 20_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, operation });
    });
  return {
    pid: child.pid!,
    origin,
    send,
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null || !child.connected) return;
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      });
      const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try {
        await send("close");
        await exited;
      } finally {
        clearTimeout(kill);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
  };
}
