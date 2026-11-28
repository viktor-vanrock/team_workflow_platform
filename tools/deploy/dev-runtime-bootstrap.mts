import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Ajv } from "ajv/dist/ajv.js";

import { pilotContentHash, type PilotRecord } from "../../packages/platform-core/src/index.ts";
import {
  PilotRepository,
  type RuntimeConfigurationPublication,
  RuntimeConfigurationRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  createWorkspaceInstallationDataSource,
  parseDeploymentPolicy,
} from "../../packages/runtime-composition/src/index.ts";

type Bundle = {
  schemaVersion: 1;
  deploymentPolicy: unknown;
  configurations: { expectedRowVersion: number; publication: RuntimeConfigurationPublication }[];
  deployments: { expectedRowVersion: number; record: PilotRecord }[];
};

/** The protected dev CI job authorizes publication; the service identity is created internally. */
export async function publishDevRuntimeBundle(
  source: ReturnType<typeof createWorkspaceInstallationDataSource>,
  raw: unknown,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (env.AWP_ENVIRONMENT !== "NON_PROD" || env.AWP_SUPERADMIN_ENVIRONMENT !== "dev")
    throw new Error("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
  const schema: unknown = JSON.parse(
    readFileSync(new URL("./dev-runtime-bootstrap.schema.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv();
  if (!ajv.validate(schema as object, raw)) throw new Error("DEV_RUNTIME_BOOTSTRAP_INVALID");
  const bundle = raw as Bundle;
  const policy = parseDeploymentPolicy(bundle.deploymentPolicy);
  if (policy.environmentScope !== "NON_PROD" || policy.runtimeProfile !== "non-local")
    throw new Error("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
  const expected = new Map([
    ["INPUT_PACKAGE", policy.inputPackageRef],
    ["IDENTITY_POLICY", policy.identityPolicyRef],
    ["SECRET_RESOLVER_POLICY", policy.secretResolverPolicyRef],
    ["SIGNING_POLICY", policy.signingPolicyRef],
    ["TELEMETRY_POLICY", policy.telemetryPolicyRef],
    ["NETWORK_POLICY", policy.networkPolicyRef],
    ["ARTIFACT_POLICY", policy.artifactPolicyRef],
    ["MODEL_POLICY", policy.modelPolicyRef],
    ["RECOVERY_POLICY", policy.recoveryPolicyRef],
  ]);
  const refs = [...expected.values(), ...policy.connectorBindings.map((entry) => entry.ref)];
  if (
    bundle.configurations.length !== refs.length ||
    new Set(refs.map((ref) => ref.id)).size !== refs.length
  )
    throw new Error("DEV_RUNTIME_BOOTSTRAP_SCOPE_INVALID");
  for (const ref of refs) {
    const matches = bundle.configurations.filter(
      ({ publication }) =>
        publication.ref?.id === ref.id &&
        publication.ref.version === ref.version &&
        publication.ref.contentHash === ref.contentHash,
    );
    const value = matches[0]?.publication;
    const expectedKind =
      [...expected.entries()].find(([, item]) => item.id === ref.id)?.[0] ?? "CONNECTOR_BINDING";
    if (
      matches.length !== 1 ||
      !value ||
      value.kind !== expectedKind ||
      value.workspaceId !== policy.workspaceId ||
      !Array.isArray(value.projectIds) ||
      value.projectIds.length !== policy.projectIds.length ||
      !policy.projectIds.every((id) => value.projectIds.includes(id))
    )
      throw new Error("DEV_RUNTIME_BOOTSTRAP_SCOPE_INVALID");
  }
  if (bundle.deployments.length !== policy.projectIds.length)
    throw new Error("DEV_RUNTIME_BOOTSTRAP_SCOPE_INVALID");
  for (const projectId of policy.projectIds) {
    const selected = bundle.deployments.filter(({ record }) => record.projectId === projectId);
    const record = selected[0]?.record;
    if (
      selected.length !== 1 ||
      !record ||
      record.kind !== "DEPLOYMENT" ||
      record.id !== policy.deploymentId ||
      record.version !== policy.version ||
      record.workspaceId !== policy.workspaceId ||
      pilotContentHash(record.body) !== pilotContentHash(policy)
    )
      throw new Error("DEV_RUNTIME_BOOTSTRAP_SCOPE_INVALID");
  }
  await source.transaction("SERIALIZABLE", async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "dev-runtime-bootstrap-service-identity",
    ]);
    const candidate = randomUUID();
    const inserted = (await manager.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'urn:awp:bootstrap','dev-runtime-configuration','SERVICE','Dev runtime bootstrap') ON CONFLICT(issuer,subject) DO NOTHING RETURNING id",
      [candidate],
    )) as { id: string }[];
    const identities = (await manager.query(
      "SELECT id,kind FROM identities WHERE issuer='urn:awp:bootstrap' AND subject='dev-runtime-configuration' FOR SHARE",
    )) as { id: string; kind: string }[];
    if (identities.length !== 1 || identities[0]!.kind !== "SERVICE")
      throw new Error("DEV_RUNTIME_BOOTSTRAP_SERVICE_IDENTITY_CONFLICT");
    const actorId = identities[0]!.id;
    if (inserted.length) {
      const correlation = randomUUID();
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,NULL,clock_timestamp(),$3,'runtime-bootstrap.identity.create','SUCCEEDED','DEV_BOOTSTRAP',$4,$4,NULL,'INTERNAL',$5)",
        [
          randomUUID(),
          policy.workspaceId,
          { kind: "SERVICE", principalId: actorId, serviceKey: "dev-runtime-bootstrap" },
          correlation,
          { issuer: "urn:awp:bootstrap", subject: "dev-runtime-configuration" },
        ],
      );
    }
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `dev-runtime-bootstrap:${policy.workspaceId}`,
    ]);
    const configurations = new RuntimeConfigurationRepository();
    const pilots = new PilotRepository(source);
    for (const { publication: rawPublication, expectedRowVersion } of bundle.configurations) {
      const publication = { ...rawPublication, publishedBy: actorId };
      const heads = (await manager.query(
        "SELECT current_version,current_hash,state FROM runtime_configuration_headers WHERE workspace_id=$1 AND configuration_id=$2 FOR UPDATE",
        [publication.workspaceId, publication.ref.id],
      )) as { current_version: number; current_hash: string; state: string }[];
      if (heads[0] && heads[0].current_version > publication.ref.version)
        throw new Error("DEV_RUNTIME_BOOTSTRAP_CONFLICT");
      if (
        heads[0]?.current_version === publication.ref.version &&
        (heads[0].current_hash !== publication.ref.contentHash || heads[0].state !== "PUBLISHED")
      )
        throw new Error("DEV_RUNTIME_BOOTSTRAP_CONFLICT");
      await configurations.publish(manager, publication, expectedRowVersion);
      if (!heads.length || heads[0]?.current_version !== publication.ref.version) {
        const correlation = randomUUID();
        await manager.query(
          "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,NULL,clock_timestamp(),$3,'runtime-config.bootstrap','SUCCEEDED','DEV_BOOTSTRAP',$4,$4,NULL,'INTERNAL',$5)",
          [
            randomUUID(),
            policy.workspaceId,
            { kind: "SERVICE", principalId: actorId, serviceKey: "dev-runtime-bootstrap" },
            correlation,
            { kind: publication.kind, ref: publication.ref },
          ],
        );
      }
    }
    for (const { record: rawRecord, expectedRowVersion } of bundle.deployments) {
      const { contentHash: _contentHash, ...rawBody } = rawRecord;
      void _contentHash;
      const body = { ...rawBody, actorRef: actorId };
      const record = { ...body, contentHash: pilotContentHash(body) };
      const heads = (await manager.query(
        "SELECT current_version,current_hash FROM pilot_record_headers WHERE workspace_id=$1 AND project_id=$2 AND record_id=$3 FOR UPDATE",
        [record.workspaceId, record.projectId, record.id],
      )) as { current_version: number; current_hash: string }[];
      if (heads[0] && heads[0].current_version > record.version)
        throw new Error("DEV_RUNTIME_BOOTSTRAP_CONFLICT");
      if (
        heads[0]?.current_version === record.version &&
        heads[0].current_hash !== record.contentHash
      )
        throw new Error("DEV_RUNTIME_BOOTSTRAP_CONFLICT");
      await pilots.publish(record, expectedRowVersion, manager);
      if (!heads.length || heads[0]?.current_version !== record.version) {
        const correlation = randomUUID();
        await manager.query(
          "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,'runtime-deployment.bootstrap','SUCCEEDED','DEV_BOOTSTRAP',$5,$5,NULL,'INTERNAL',$6)",
          [
            randomUUID(),
            record.workspaceId,
            record.projectId,
            { kind: "SERVICE", principalId: actorId, serviceKey: "dev-runtime-bootstrap" },
            correlation,
            { id: record.id, version: record.version, contentHash: record.contentHash },
          ],
        );
      }
    }
  });
}

if (process.argv[1]?.endsWith("dev-runtime-bootstrap.mts")) {
  let source: ReturnType<typeof createWorkspaceInstallationDataSource> | undefined;
  try {
    if (
      process.env.AWP_ENVIRONMENT !== "NON_PROD" ||
      process.env.AWP_SUPERADMIN_ENVIRONMENT !== "dev"
    )
      throw new Error("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
    const path = process.env.AWP_DEV_RUNTIME_BOOTSTRAP_PATH;
    if (!path) throw new Error("DEV_RUNTIME_BOOTSTRAP_INPUT_REQUIRED");
    const bytes = readFileSync(path);
    if (!bytes.length || bytes.length > 2_000_000) throw new Error("DEV_RUNTIME_BOOTSTRAP_INVALID");
    const bundle: unknown = JSON.parse(bytes.toString("utf8"));
    source = createWorkspaceInstallationDataSource();
    await source.initialize();
    await publishDevRuntimeBundle(source, bundle, process.env);
    console.log("DEV_RUNTIME_BOOTSTRAP_COMPLETED");
  } catch (error) {
    const message =
      error instanceof Error &&
      /^(DEV_RUNTIME_BOOTSTRAP_[A-Z_]+|RUNTIME_CONFIGURATION_CONFLICT|PILOT_(VERSION|IMMUTABLE)_CONFLICT)$/u.test(
        error.message,
      )
        ? error.message
        : "DEV_RUNTIME_BOOTSTRAP_FAILED";
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
}
