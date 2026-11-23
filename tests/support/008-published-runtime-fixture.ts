import { randomUUID } from "node:crypto";

import {
  type ExactRevisionRef,
  INPUT_REQUIREMENTS_008,
  pilotContentHash,
  type PilotRecord,
} from "../../packages/platform-core/src/index.ts";
import {
  PilotRepository,
  type RuntimeConfigurationKind,
  type RuntimeConfigurationPublication,
  RuntimeConfigurationRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import { parseDeploymentPolicy } from "../../packages/runtime-composition/src/pilot/deployment-config.ts";
import { startUs3DatabaseFixture, stopUs3DatabaseFixture, us3Actor } from "./002-us3-database.ts";

const exact = (id: string, document: unknown): ExactRevisionRef => ({
  id,
  version: 1,
  contentHash: pilotContentHash(document) as ExactRevisionRef["contentHash"],
});

/** Published, controlled metadata for composition tests. It is engineering evidence only. */
export async function startPublishedRuntimeFixture008(postgresImage: string) {
  const fixture = await startUs3DatabaseFixture({ postgresImage });
  try {
    const scope = { workspaceId: fixture.workspaceId, projectIds: [fixture.projectId] };
    const repository = new RuntimeConfigurationRepository();
    const publish = async (
      kind: RuntimeConfigurationKind,
      document: Record<string, unknown>,
      id = randomUUID(),
    ) => {
      const publication: RuntimeConfigurationPublication = {
        schemaVersion: 1,
        ...scope,
        kind,
        ref: exact(id, document),
        document: document as RuntimeConfigurationPublication["document"],
        publishedBy: us3Actor.principalId,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        validUntil: new Date(Date.now() + 600_000).toISOString(),
        correlationId: randomUUID(),
      };
      await fixture.source.transaction((manager) => repository.publish(manager, publication, 0));
      return publication.ref;
    };
    const endpoints = [
      {
        purpose: "identity",
        url: "https://identity.example.test/oidc",
        allowedOrigin: "https://identity.example.test",
      },
      {
        purpose: "vault",
        url: "https://vault.example.test",
        allowedOrigin: "https://vault.example.test",
      },
      {
        purpose: "browser",
        url: "https://web.example.test",
        allowedOrigin: "https://web.example.test",
      },
      {
        purpose: "callback",
        url: "https://web.example.test/api/v1/auth/callback",
        allowedOrigin: "https://web.example.test",
      },
    ];
    const connectorBindings: {
      provider: "jira" | "gitlab" | "mattermost";
      ref: ExactRevisionRef;
    }[] = [];
    const providerProjects: {
      provider: "jira" | "gitlab" | "mattermost";
      endpoint: string;
      integrationBindingRef: ExactRevisionRef;
      profileRef: ExactRevisionRef;
      connectionRef: ExactRevisionRef;
    }[] = [];
    for (const provider of ["jira", "gitlab", "mattermost"] as const) {
      const endpoint = `https://${provider}.example.test`;
      endpoints.push({ purpose: provider, url: endpoint, allowedOrigin: endpoint });
      const connectorKey = `connector-${provider}`;
      const connection = { connectorKey, baseUrl: endpoint };
      const connectionRef = exact(randomUUID(), connection);
      const profile = {
        connectorKey,
        connectionRef,
        capabilityConfigurations: [
          {
            capabilityKey: provider,
            exactContractVersion: "1.0.0",
            environmentScopes: ["NON_PROD"],
          },
        ],
      };
      const profileRef = exact(randomUUID(), profile);
      const binding = {
        entries: [
          {
            profileRef,
            capabilityKey: provider,
            exactContractVersion: "1.0.0",
            environmentScope: "NON_PROD",
          },
        ],
      };
      const integrationBindingRef = exact(randomUUID(), binding);
      for (const [table, ref, content] of [
        ["connection", connectionRef, connection],
        ["connector_profile", profileRef, profile],
        ["project_integration_binding", integrationBindingRef, binding],
      ] as const) {
        const projectScoped = table === "project_integration_binding";
        await fixture.source.query(
          `INSERT INTO ${table}_headers(id,workspace_id,key,current_published_version${projectScoped ? ",project_id" : ""}) VALUES($1,$2,$3,1${projectScoped ? ",$4" : ""})`,
          [
            ref.id,
            fixture.workspaceId,
            randomUUID(),
            ...(projectScoped ? [fixture.projectId] : []),
          ],
        );
        await fixture.source.query(
          `INSERT INTO ${table}_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at${projectScoped ? ",project_id" : ""}) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now()${projectScoped ? ",$6" : ""})`,
          [
            randomUUID(),
            fixture.workspaceId,
            ref.id,
            content,
            ref.contentHash,
            ...(projectScoped ? [fixture.projectId] : []),
          ],
        );
      }
      const projects = [
        {
          projectId: fixture.projectId,
          connectorKey,
          endpoint,
          integrationBindingRef,
          profileRef,
          connectionRef,
        },
      ];
      connectorBindings.push({
        provider,
        ref: await publish("CONNECTOR_BINDING", { provider, projects }),
      });
      providerProjects.push({
        provider,
        endpoint,
        integrationBindingRef,
        profileRef,
        connectionRef,
      });
    }
    const listFields = new Set([
      "projectRefs",
      "channelRefs",
      "secretRefs",
      "origins",
      "callbackRoutes",
      "humanRefs",
      "sourceRefs",
    ]);
    const entries = Object.entries(INPUT_REQUIREMENTS_008).map(([id, fields]) => {
      const metadata: Record<string, unknown> = Object.fromEntries(
        fields.map((field) => [
          field,
          listFields.has(field) ? ["urn:approved:reference"] : "urn:approved:reference",
        ]),
      );
      if (id === "IN-02")
        metadata.providers = ["JIRA", "GITLAB", "MATTERMOST"].map((type) => ({
          type,
          edition: "controlled",
          version: "1.0",
          apiDialect: "controlled-v1",
          authStrategy: "controlled",
          documentRef: "urn:approved:doc",
          permissionsRef: "urn:approved:permissions",
        }));
      if (id === "IN-03") metadata.issuer = "https://identity.example.test/oidc";
      if (id === "IN-07") metadata.artifactMode = "GITLAB_ONLY";
      if (id === "IN-08") metadata.backupMethod = "LOGICAL";
      const body = {
        id,
        version: 1,
        ...scope,
        synthetic: false,
        status: "ACCEPTED",
        suppliedBy: us3Actor.principalId,
        reviewedBy: us3Actor.principalId,
        reviewedAt: new Date(Date.now() - 2000).toISOString(),
        evidenceRef: "urn:approved:evidence",
        metadata,
      };
      return { ...body, contentHash: pilotContentHash(body) };
    });
    const inputId = randomUUID();
    const input = {
      schemaVersion: 1,
      id: inputId,
      version: 1,
      profile: "integration",
      scope,
      entries,
    };
    const policyRefs: Record<string, ExactRevisionRef> = {
      inputPackageRef: await publish("INPUT_PACKAGE", input, inputId),
    };
    for (const [key, kind] of Object.entries({
      identityPolicyRef: "IDENTITY_POLICY",
      secretResolverPolicyRef: "SECRET_RESOLVER_POLICY",
      signingPolicyRef: "SIGNING_POLICY",
      telemetryPolicyRef: "TELEMETRY_POLICY",
      artifactPolicyRef: "ARTIFACT_POLICY",
      modelPolicyRef: "MODEL_POLICY",
      recoveryPolicyRef: "RECOVERY_POLICY",
    } as const))
      policyRefs[key] = await publish(kind, { mode: "CORPORATE", dialect: "controlled" });
    const networkBody = {
      mode: "CORPORATE" as const,
      validUntil: new Date(Date.now() + 600_000).toISOString(),
      deadlineMs: 1000,
      maximumRequestBytes: 4096,
      maximumResponseBytes: 4096,
      endpoints: endpoints
        .filter((value) => !["browser", "callback"].includes(value.purpose))
        .map((value) => ({
          origin: value.allowedOrigin,
          addressRanges: ["10.42.0.0/24"],
          routes: [
            {
              path: new URL(value.url).pathname,
              match: "EXACT" as const,
              methods: ["GET", "POST"],
              queryKeys: [],
            },
          ],
        })),
    };
    const networkRef = await publish("NETWORK_POLICY", networkBody);
    const policy = parseDeploymentPolicy({
      schemaVersion: 1,
      deploymentId: randomUUID(),
      version: 1,
      deploymentProfile: "integration",
      runtimeProfile: "non-local",
      environmentScope: "NON_PROD",
      compositionKey: "qa-jira-gitlab-mattermost-test",
      ...scope,
      imageDigest: `sha256:${"a".repeat(64)}`,
      artifactMode: "GITLAB_ONLY",
      ...policyRefs,
      networkPolicyRef: networkRef,
      connectorBindings,
      endpoints,
    });
    const deployment = {
      schemaVersion: 1 as const,
      kind: "DEPLOYMENT" as const,
      id: policy.deploymentId,
      version: policy.version,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      actorRef: us3Actor.principalId,
      correlationId: randomUUID(),
      createdAt: new Date().toISOString(),
      body: policy,
    };
    await new PilotRepository(fixture.source).publish(
      { ...deployment, contentHash: pilotContentHash(deployment) } as unknown as PilotRecord,
      0,
    );
    return { ...fixture, policy, networkBody, networkRef, providerProjects };
  } catch (error) {
    await stopUs3DatabaseFixture(fixture);
    throw error;
  }
}

export { stopUs3DatabaseFixture as stopPublishedRuntimeFixture008 };
