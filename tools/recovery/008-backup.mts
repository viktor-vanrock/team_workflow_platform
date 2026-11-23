import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { containsSensitiveValue008 } from "../verification/feature-008-inputs.mts";
import {
  FEATURE_008,
  record,
  ROOT_008,
  safeFile,
  write008Json,
} from "../verification/feature-008-prerequisites.mts";

export interface BackupInventory008 {
  readonly canonical: number;
  readonly audit: number;
  readonly delivery: number;
  readonly configuration: number;
  readonly publicKeys: number;
  readonly artifacts: number;
}
export interface BackupManifestInput008 {
  readonly backupId: string;
  readonly sourceDeploymentRef: string;
  readonly workspaceId: string;
  readonly projectIds: readonly string[];
  readonly databaseIdentity: string;
  readonly databaseMajor: number;
  readonly backupKind: "LOGICAL" | "PHYSICAL_PITR";
  readonly backupStartedAt: string;
  readonly completedAt: string;
  readonly consistentRecoveryPoint: string;
  readonly schemaPins: Readonly<Record<string, number>>;
  readonly inventory: BackupInventory008;
  readonly auditWatermark: string;
  readonly effectWatermark: string;
  readonly protectedLocationRef: string;
  readonly retentionPolicyRef: string;
  readonly dumpDigest: string;
  readonly dumpBytes: number;
  readonly wal?: {
    readonly timeline: string;
    readonly firstSegment: string;
    readonly lastSegment: string;
  };
}
const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const digest = /^sha256:[a-f0-9]{64}$/u,
  time = (value: string) => Date.parse(value);
export function buildBackupManifest008(input: BackupManifestInput008) {
  if (
    !input.backupId ||
    !input.sourceDeploymentRef ||
    !input.workspaceId ||
    !input.projectIds.length ||
    new Set(input.projectIds).size !== input.projectIds.length ||
    !input.databaseIdentity ||
    ![17, 18].includes(input.databaseMajor) ||
    !Number.isFinite(time(input.backupStartedAt)) ||
    !Number.isFinite(time(input.completedAt)) ||
    !Number.isFinite(time(input.consistentRecoveryPoint)) ||
    time(input.backupStartedAt) > time(input.completedAt) ||
    time(input.consistentRecoveryPoint) > time(input.completedAt) ||
    !Object.keys(input.schemaPins).length ||
    Object.values(input.schemaPins).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    Object.values(input.inventory).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !input.auditWatermark ||
    !input.effectWatermark ||
    !input.protectedLocationRef ||
    !input.retentionPolicyRef ||
    !digest.test(input.dumpDigest) ||
    !Number.isSafeInteger(input.dumpBytes) ||
    input.dumpBytes < 1 ||
    (input.backupKind === "PHYSICAL_PITR" && !input.wal) ||
    (input.backupKind === "LOGICAL" && input.wal)
  )
    throw new Error("BACKUP_MANIFEST_INVALID");
  if (containsSensitiveValue008(input)) throw new Error("BACKUP_MANIFEST_SENSITIVE");
  const inventories = {
    canonical: hash({ count: input.inventory.canonical, watermark: input.consistentRecoveryPoint }),
    audit: hash({ count: input.inventory.audit, watermark: input.auditWatermark }),
    delivery: hash({ count: input.inventory.delivery, watermark: input.effectWatermark }),
    configuration: hash({ count: input.inventory.configuration, schemaPins: input.schemaPins }),
    publicKeys: hash({ count: input.inventory.publicKeys }),
    artifacts: hash({ count: input.inventory.artifacts }),
  };
  const body = {
    schemaVersion: "backup-manifest@1.0.0" as const,
    ...input,
    projectIds: Object.freeze([...input.projectIds].sort()),
    inventoryHashes: Object.freeze(inventories),
  };
  return Object.freeze({ ...body, contentHash: hash(body) });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [flag, path] = process.argv.slice(2);
  if (flag !== "--input" || !path || process.argv.length !== 4)
    throw new Error("BACKUP_ARGUMENT_INVALID");
  const value: unknown = JSON.parse(readFileSync(safeFile(ROOT_008, path), "utf8"));
  if (!record(value)) throw new Error("BACKUP_INPUT_INVALID");
  const manifest = buildBackupManifest008(value as unknown as BackupManifestInput008);
  write008Json(`reports/${FEATURE_008}/backup-manifest.json`, manifest);
  console.log(`[recovery:008:backup] PASS; backup=${manifest.backupId}`);
}
