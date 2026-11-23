import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface LogicalRestoreInput008 {
  readonly sourceContainerId: string;
  readonly targetContainerId: string;
  readonly database: string;
  readonly user: string;
  readonly expectedTargetId: string;
  readonly tables: readonly string[];
}
const identifier = /^[a-z][a-z0-9_]{0,62}$/u,
  container = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u;
function docker(args: readonly string[], input?: Buffer) {
  const result = spawnSync("docker", [...args], {
    encoding: input ? null : "utf8",
    input,
    timeout: 120_000,
    maxBuffer: 50_000_000,
  });
  if (result.status !== 0 || result.error) {
    const detail = result.stderr ?? result.error?.message ?? "";
    throw new Error(
      `LOGICAL_RESTORE_COMMAND_FAILED:${typeof detail === "string" ? detail.trim() : detail.toString().trim()}`,
    );
  }
  return result;
}
function scalar(containerId: string, user: string, database: string, sql: string): string {
  const output = docker([
    "exec",
    containerId,
    "psql",
    "-U",
    user,
    "-d",
    database,
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]).stdout;
  return typeof output === "string" ? output.trim() : output.toString().trim();
}
export function assertIsolatedRestoreTarget008(input: LogicalRestoreInput008): void {
  if (
    !container.test(input.sourceContainerId) ||
    !container.test(input.targetContainerId) ||
    input.sourceContainerId === input.targetContainerId ||
    !identifier.test(input.database) ||
    !identifier.test(input.user) ||
    !input.expectedTargetId ||
    !input.tables.length ||
    input.tables.some((table) => !identifier.test(table)) ||
    new Set(input.tables).size !== input.tables.length
  )
    throw new Error("LOGICAL_RESTORE_INPUT_INVALID");
  const identity = scalar(
    input.targetContainerId,
    input.user,
    input.database,
    "SELECT target_id||':'||isolated::text||':'||fenced::text FROM recovery_target_identity LIMIT 2",
  );
  if (identity !== `${input.expectedTargetId}:true:true`)
    throw new Error("LOGICAL_RESTORE_TARGET_DENIED");
  const active = scalar(
    input.targetContainerId,
    input.user,
    input.database,
    "SELECT count(*) FROM recovery_runtime_leases WHERE state='ACTIVE'",
  );
  if (active !== "0") throw new Error("LOGICAL_RESTORE_ACTIVE_TARGET_DENIED");
}
export function restoreLogicalDump008(input: LogicalRestoreInput008) {
  assertIsolatedRestoreTarget008(input);
  const args = [
    "exec",
    input.sourceContainerId,
    "pg_dump",
    "-U",
    input.user,
    "-d",
    input.database,
    "--no-owner",
    "--no-privileges",
    ...input.tables.flatMap((table) => ["--table", table]),
  ];
  const dumped = docker(args),
    bytes = Buffer.isBuffer(dumped.stdout) ? dumped.stdout : Buffer.from(dumped.stdout);
  if (!bytes.length) throw new Error("LOGICAL_RESTORE_EMPTY_DUMP");
  docker(
    [
      "exec",
      "-i",
      input.targetContainerId,
      "psql",
      "-U",
      input.user,
      "-d",
      input.database,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    bytes,
  );
  return Object.freeze({
    status: "PASS" as const,
    dumpBytes: bytes.length,
    dumpDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    tables: Object.freeze([...input.tables]),
    targetId: input.expectedTargetId,
    workerEgress: "FENCED" as const,
  });
}
