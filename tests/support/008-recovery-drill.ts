import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import {
  assertIsolatedRestoreTarget008,
  type LogicalRestoreInput008,
  restoreLogicalDump008,
} from "../../tools/recovery/008-restore.mts";

const sql = async (postgres: RunningPostgres, value: string) => {
  const result = await postgres.container.exec([
    "psql",
    "-U",
    "awp_test",
    "-d",
    "awp_test",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    value,
  ]);
  if (result.exitCode !== 0) throw new Error(`RECOVERY_FIXTURE_SQL_FAILED:${result.stderr}`);
  return result.stdout;
};
export interface RecoveryPair008 {
  readonly source: RunningPostgres;
  readonly target: RunningPostgres;
  readonly input: LogicalRestoreInput008;
  close(): Promise<void>;
}
export async function startRecoveryPair008(): Promise<RecoveryPair008> {
  const source = await startPostgres("postgres:18.6-bookworm"),
    target = await startPostgres("postgres:18.6-bookworm");
  try {
    await sql(
      source,
      `CREATE TABLE canonical_records(id text PRIMARY KEY,body jsonb NOT NULL);CREATE TABLE recovery_commands(id text PRIMARY KEY,effect_key text UNIQUE NOT NULL,state text NOT NULL);CREATE TABLE recovery_audit(seq integer PRIMARY KEY,content_hash text NOT NULL);CREATE TABLE recovery_keys(id text PRIMARY KEY,public_jwk jsonb NOT NULL);CREATE TABLE recovery_artifacts(id text PRIMARY KEY,state text NOT NULL,metadata_hash text NOT NULL,bytes_hash text);INSERT INTO canonical_records VALUES('record-1','{"state":"confirmed"}');INSERT INTO recovery_commands VALUES('command-1','effect-before-backup','CONFIRMED'),('command-2','effect-uncertain','DISPATCHED');INSERT INTO recovery_audit VALUES(1,'sha256:audit-1'),(2,'sha256:audit-2');INSERT INTO recovery_keys VALUES('key-1','{"kty":"OKP","crv":"Ed25519"}');INSERT INTO recovery_artifacts VALUES('required','AVAILABLE','sha256:metadata-required','sha256:bytes-required'),('expired','EXPIRED','sha256:metadata-expired',NULL);`,
    );
    await sql(
      target,
      "CREATE TABLE recovery_target_identity(target_id text PRIMARY KEY,isolated boolean NOT NULL,fenced boolean NOT NULL);CREATE TABLE recovery_runtime_leases(runtime_id text PRIMARY KEY,state text NOT NULL);INSERT INTO recovery_target_identity VALUES('isolated-drill-008',true,true);",
    );
    const input = {
      sourceContainerId: source.container.getId(),
      targetContainerId: target.container.getId(),
      database: "awp_test",
      user: "awp_test",
      expectedTargetId: "isolated-drill-008",
      tables: [
        "canonical_records",
        "recovery_commands",
        "recovery_audit",
        "recovery_keys",
        "recovery_artifacts",
      ],
    } as const;
    return Object.freeze({
      source,
      target,
      input,
      close: async () => {
        await Promise.allSettled([source.stop(), target.stop()]);
      },
    });
  } catch (error) {
    await Promise.allSettled([source.stop(), target.stop()]);
    throw error;
  }
}
export async function runLocalRestoreDrill008() {
  const pair = await startRecoveryPair008();
  try {
    const restore = restoreLogicalDump008(pair.input),
      counts = JSON.parse(
        await sql(
          pair.target,
          "SELECT json_build_object('canonical',(SELECT count(*) FROM canonical_records),'commands',(SELECT count(*) FROM recovery_commands),'audit',(SELECT count(*) FROM recovery_audit),'keys',(SELECT count(*) FROM recovery_keys),'artifacts',(SELECT count(*) FROM recovery_artifacts));",
        ).then(
          (value) =>
            value
              .split("\n")
              .find((line) => line.trim().startsWith("{"))
              ?.trim() ?? "{}",
        ),
      ) as Record<string, number>;
    return Object.freeze({
      restore,
      counts,
      targetIdentityChecked: true,
      activeTargetRejected: await activeTargetRejected(pair),
    });
  } finally {
    await pair.close();
  }
}
async function activeTargetRejected(pair: RecoveryPair008): Promise<boolean> {
  await sql(pair.target, "INSERT INTO recovery_runtime_leases VALUES('active-runtime','ACTIVE');");
  try {
    assertIsolatedRestoreTarget008(pair.input);
    return false;
  } catch (error) {
    return error instanceof Error && error.message === "LOGICAL_RESTORE_ACTIVE_TARGET_DENIED";
  } finally {
    await sql(pair.target, "DELETE FROM recovery_runtime_leases;");
  }
}
