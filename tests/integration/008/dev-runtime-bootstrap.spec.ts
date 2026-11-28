import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { publishDevRuntimeBundle } from "../../../tools/deploy/dev-runtime-bootstrap.mts";
import { startUs3DatabaseFixture, stopUs3DatabaseFixture } from "../../support/002-us3-database.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const env = { AWP_ENVIRONMENT: "NON_PROD", AWP_SUPERADMIN_ENVIRONMENT: "dev" };
const kinds = [
  "INPUT_PACKAGE",
  "IDENTITY_POLICY",
  "SECRET_RESOLVER_POLICY",
  "SIGNING_POLICY",
  "TELEMETRY_POLICY",
  "NETWORK_POLICY",
  "ARTIFACT_POLICY",
  "MODEL_POLICY",
  "RECOVERY_POLICY",
  "CONNECTOR_BINDING",
  "CONNECTOR_BINDING",
  "CONNECTOR_BINDING",
] as const;

function bundle(workspaceId: string, projectId: string, actorId: string) {
  const configurations = kinds.map((kind, index) => {
    const document = { setting: `setting-${index}` };
    return {
      expectedRowVersion: 0,
      publication: {
        schemaVersion: 1 as const,
        workspaceId,
        projectIds: [projectId],
        kind,
        ref: { id: randomUUID(), version: 1, contentHash: pilotContentHash(document) },
        document,
        publishedBy: actorId,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        validUntil: new Date(Date.now() + 600000).toISOString(),
        correlationId: randomUUID(),
      },
    };
  });
  const refs = configurations.map(({ publication }) => publication.ref);
  const deploymentPolicy = {
    schemaVersion: 1,
    deploymentId: randomUUID(),
    version: 1,
    deploymentProfile: "integration",
    runtimeProfile: "non-local",
    environmentScope: "NON_PROD",
    compositionKey: "qa-jira-gitlab-mattermost-test",
    workspaceId,
    projectIds: [projectId],
    imageDigest: `sha256:${"a".repeat(64)}`,
    artifactMode: "GITLAB_ONLY",
    inputPackageRef: refs[0],
    identityPolicyRef: refs[1],
    secretResolverPolicyRef: refs[2],
    signingPolicyRef: refs[3],
    telemetryPolicyRef: refs[4],
    networkPolicyRef: refs[5],
    artifactPolicyRef: refs[6],
    modelPolicyRef: refs[7],
    recoveryPolicyRef: refs[8],
    connectorBindings: ["jira", "gitlab", "mattermost"].map((provider, index) => ({
      provider,
      ref: refs[index + 9],
    })),
    endpoints: [
      {
        purpose: "identity",
        url: "https://identity.example/oidc",
        allowedOrigin: "https://identity.example",
      },
    ],
  };
  const recordBody = {
    id: deploymentPolicy.deploymentId,
    version: 1,
    schemaVersion: 1 as const,
    kind: "DEPLOYMENT" as const,
    workspaceId,
    projectId,
    actorRef: actorId,
    correlationId: randomUUID(),
    createdAt: new Date().toISOString(),
    body: deploymentPolicy,
  };
  return {
    schemaVersion: 1,
    deploymentPolicy,
    configurations,
    deployments: [
      {
        expectedRowVersion: 0,
        record: { ...recordBody, contentHash: pilotContentHash(recordBody) },
      },
    ],
  };
}

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "dev runtime bootstrap PostgreSQL",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "publishes, replays, rejects conflicts and rolls back on %s",
      async (image) => {
        const f = await startUs3DatabaseFixture({ postgresImage: image });
        try {
          const actor = randomUUID();
          await f.source.query(
            "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'urn:bootstrap:test',$2,'SERVICE','bootstrap')",
            [actor, randomUUID()],
          );
          const value = bundle(f.workspaceId, f.projectId, actor);
          const put = (input: unknown, environment = env) =>
            publishDevRuntimeBundle(f.source, input, environment);
          await put(value);
          const counts = async () =>
            await f.source.query(
              "SELECT (SELECT count(*)::int FROM runtime_configuration_revisions) AS configs,(SELECT count(*)::int FROM pilot_record_revisions WHERE kind='DEPLOYMENT') AS deployments,(SELECT count(*)::int FROM audit_events WHERE action IN ('runtime-config.bootstrap','runtime-deployment.bootstrap')) AS audits",
            );
          const before = await counts();
          expect(before).toEqual([{ configs: 12, deployments: 1, audits: 13 }]);
          expect(
            await f.source.query("SELECT kind FROM identities WHERE issuer=$1 AND subject=$2", [
              "urn:awp:bootstrap",
              "dev-runtime-configuration",
            ]),
          ).toEqual([{ kind: "SERVICE" }]);
          expect(
            await f.source.query("SELECT count(*)::int AS n FROM audit_events WHERE action=$1", [
              "runtime-bootstrap.identity.create",
            ]),
          ).toEqual([{ n: 1 }]);
          await put(value);
          expect(await counts()).toEqual(before);
          const changed = structuredClone(value);
          changed.configurations[0]!.publication.correlationId = randomUUID();
          await expect(put(changed)).rejects.toThrow("RUNTIME_CONFIGURATION_CONFLICT");
          expect(await counts()).toEqual(before);
          const invalid = bundle(f.workspaceId, f.projectId, actor);
          invalid.configurations[11]!.publication.document.setting = "tampered";
          await expect(put(invalid)).rejects.toThrow();
          expect(await counts()).toEqual(before);
          await expect(
            put(value, { AWP_ENVIRONMENT: "NON_PROD", AWP_SUPERADMIN_ENVIRONMENT: "prod" }),
          ).rejects.toThrow("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
          await expect(
            put(value, { AWP_ENVIRONMENT: "PLATFORM_PROD", AWP_SUPERADMIN_ENVIRONMENT: "dev" }),
          ).rejects.toThrow("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
          expect(await counts()).toEqual(before);
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      360000,
    );
  },
);
