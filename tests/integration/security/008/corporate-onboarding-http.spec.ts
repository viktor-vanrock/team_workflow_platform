import "../../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NestFactory } from "../../../../apps/api/node_modules/@nestjs/core/index.js";
import { PilotNonLocalApiModule } from "../../../../apps/api/src/app.module.ts";
import { CorporateOnboardingModule } from "../../../../apps/api/src/extensions/onboarding/corporate-onboarding.module.ts";
import type { EvidenceCrypto } from "../../../../apps/api/src/extensions/onboarding/evidence.application.ts";
import { evidenceContentHash } from "../../../../packages/competency-qa/src/index.ts";
import {
  qaCompetencyManifestV13,
  qaValidationWorkTypeDefinitionV13,
} from "../../../../packages/competency-qa/src/node.ts";
import { createPlatformDataSource } from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../../packages/platform-testkit/src/postgres.ts";
import { PinnedNetworkTransport } from "../../../../packages/runtime-composition/src/pilot/network-policy.ts";
import { qaLocalMigrations } from "../../../../packages/runtime-composition/src/qa/composition.ts";
import {
  CorporateEvidenceSigner,
  FilePublicKeyHistory,
} from "../../../../packages/runtime-composition/src/security/corporate-evidence-signing.ts";
import { createCorporateSessionBindings } from "../../../../packages/runtime-composition/src/security/corporate-session-bindings.ts";
import { VaultHttpClient } from "../../../../packages/runtime-composition/src/security/vault-http-client.ts";
import { seedEvidenceHttpProject } from "../../../support/007-evidence-http-fixture.ts";
import { startOidcFixture } from "../../../support/008-oidc-fixture.ts";
import { startVaultFixture008 } from "../../../support/008-vault-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 non-local onboarding host",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "serves corporate sessions, registration, grants and recovery on %s",
      async (image) => {
        const postgres = await startPostgres(image);
        const source = createPlatformDataSource({
          url: postgres.url,
          entities: [],
          migrations: [...qaLocalMigrations],
        });
        const idp = await startOidcFixture();
        const vault = await startVaultFixture008();
        const directory = await mkdtemp(join(tmpdir(), "awp-corporate-onboarding-"));
        const reservation = createServer();
        await new Promise<void>((resolve) => {
          reservation.listen(0, "127.0.0.1", resolve);
        });
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>((resolve, reject) => {
          reservation.close((error) => (error ? reject(error) : resolve()));
        });
        const origin = `http://127.0.0.1:${port}`,
          workspace = randomUUID(),
          human = randomUUID(),
          recipient = randomUUID();
        const key = randomBytes(32),
          ref = {
            id: "onboarding-identity-policy",
            version: 1,
            contentHash: `sha256:${"a".repeat(64)}` as const,
          };
        // Real remote-signer adapter against a controlled HTTP endpoint holding ephemeral keys.
        const signingClient = new VaultHttpClient({
          baseUrl: vault.origin,
          namespace: "pilot/",
          mode: "LOCAL_FIXTURE",
          deadlineMs: 1000,
          maximumResponseBytes: 8192,
          authorizeEndpoint: async ({ url }) => new URL(url).origin === vault.origin,
          credentials: {
            withToken: async (_use, _signal, consume) =>
              consume("fixture-workload-credential", Date.now() + 10_000),
          },
        });
        const signerPrincipal = randomUUID();
        const evidenceCrypto = (scope: {
          workspaceId: string;
          projectId: string;
        }): EvidenceCrypto => {
          const history = new FilePublicKeyHistory(directory, scope),
            publicKeyRef = history.publish("evidence:1", 1, vault.publicJwk(1));
          const signer = new CorporateEvidenceSigner(
            signingClient,
            history,
            {
              ...scope,
              servicePrincipalId: signerPrincipal,
              mount: "transit",
              keyName: "evidence",
              keyVersion: 1,
              kid: "evidence:1",
              publicKeyRef,
              signingPolicyRef: { ...ref, id: "controlled-signing" },
            },
            async () => true,
          );
          return {
            redactionPolicyRef: { ...ref, id: "controlled-redaction" },
            exportPolicyRef: { ...ref, id: "controlled-export" },
            verify: (manifest, envelope) => signer.verify(manifest, envelope),
            signManifest: (manifest) => signer.signManifest(manifest),
          };
        };
        const permissions = [
          "project.register",
          "project.catalog.read",
          "project.onboarding.read",
          "project.entitlement.grant",
          "project.entitlement.revoke",
          "project.suspend",
          "project.resume",
          "project.onboarding.evaluate",
          "qa.evidence.read",
          "qa.evidence.verify",
          "qa.evidence.export",
        ];
        const packId = randomUUID(),
          workTypeId = randomUUID(),
          workItemId = randomUUID();
        let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
        try {
          await source.initialize();
          await source.runMigrations({ transaction: "all" });
          await source.query(
            "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.3.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',now())",
            [packId, qaCompetencyManifestV13, evidenceContentHash(qaCompetencyManifestV13)],
          );
          await source.query(
            "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.3.0',$3,$4,$5,$6,$7,'ACTIVE',now())",
            [
              workTypeId,
              packId,
              qaValidationWorkTypeDefinitionV13.intakeSchemaRef,
              qaValidationWorkTypeDefinitionV13.intakeSchemaRef.digest,
              JSON.stringify(qaValidationWorkTypeDefinitionV13.capabilityRequirements),
              qaValidationWorkTypeDefinitionV13,
              evidenceContentHash(qaValidationWorkTypeDefinitionV13),
            ],
          );
          await source.query(
            "INSERT INTO workspaces(id,key,name,state) VALUES($1,'corporate-onboarding','Corporate onboarding','ACTIVE')",
            [workspace],
          );
          for (const [principal, subject] of [
            [human, "alice"],
            [recipient, "bob"],
          ]) {
            await source.query(
              "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$3)",
              [principal, idp.origin, subject],
            );
            await source.query(
              "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')",
              [randomUUID(), workspace, principal],
            );
          }
          for (const role of ["workspace-owner", "integration-administrator"])
            await source.query(
              "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW',$5,now()-interval '1 day')",
              [randomUUID(), workspace, human, role, JSON.stringify(permissions)],
            );
          const configuration: Parameters<typeof createCorporateSessionBindings>[0] = {
            source,
            accessProvisioning: false,
            tokens: {
              issuer: idp.origin,
              audience: "awp-api",
              jwksUri: `${idp.origin}/jwks`,
              algorithms: ["EdDSA"],
              mode: "LOCAL_FIXTURE",
              discriminator: { kind: "RFC9068" },
              allowedClientIds: ["awp-browser"],
              clockToleranceSeconds: 2,
              maximumTokenAgeSeconds: 300,
              maximumTokenLifetimeSeconds: 600,
              keyCacheMs: 60_000,
              deadlineMs: 1000,
              maximumResponseBytes: 16384,
              groupsClaim: "groups",
            },
            session: {
              policyRef: ref,
              namespace: "onboarding-http-fixture",
              browserOrigin: origin,
              authorizationEndpoint: `${idp.origin}/authorize`,
              tokenEndpoint: `${idp.origin}/token`,
              callbackUrl: `${origin}/api/v1/auth/callback`,
              clientId: "awp-browser",
              scopes: ["openid"],
              returnPaths: ["/pilot/readiness"],
              loginLifetimeMs: 120_000,
              sessionLifetimeMs: 300_000,
              stepUp: { acrValues: ["urn:fixture:mfa"], amrValues: ["otp"], maximumAgeSeconds: 60 },
            },
            groups: {
              ref,
              issuer: idp.origin,
              mappings: [
                {
                  group: "qa-team",
                  workspaceId: workspace,
                  projectIds: [randomUUID()],
                  roleKeys: ["workspace-owner", "integration-administrator"],
                },
              ],
            },
            encryptionKeyId: "k1",
            encryptionKeys: { withKey: async (_id, use) => use(key) },
            network: new PinnedNetworkTransport({
              ref: { ...ref, id: "network" },
              mode: "LOCAL_FIXTURE",
              validUntil: new Date(Date.now() + 300_000).toISOString(),
              deadlineMs: 1000,
              maximumRequestBytes: 16384,
              maximumResponseBytes: 16384,
              endpoints: [
                {
                  origin: idp.origin,
                  addressRanges: ["127.0.0.1/32"],
                  routes: [
                    { path: "/jwks", match: "EXACT", methods: ["GET"], queryKeys: [] },
                    { path: "/token", match: "EXACT", methods: ["POST"], queryKeys: [] },
                  ],
                },
              ],
            }),
            clientAuthentication: {
              authorizeTokenRequest: async () => ({ headers: {}, form: {} }),
            },
          };
          let bindings = createCorporateSessionBindings(configuration);
          let policyVersion = 1;
          const boot = async () => {
            const input = {
              source,
              evidenceImport: {
                ingest: async () => {
                  throw new Error("UNUSED_PILOT_IMPORT");
                },
              } as never,
              readinessQuery: {
                query: async () => {
                  throw new Error("UNUSED_PILOT_READINESS");
                },
              } as never,
              onboarding: {
                sessions: bindings.sessions,
                accountInventory: {
                  slots: async () => {
                    throw new Error("UNCONFIGURED_ACCOUNT_POOL");
                  },
                },
                evidenceCrypto,
              },
            };
            expect(() =>
              PilotNonLocalApiModule.register({
                ...input,
                identity: {
                  authenticate: async () => {
                    throw new Error("UNUSED_IDENTITY");
                  },
                },
              }),
            ).toThrow("PILOT_NON_LOCAL_IDENTITY_AMBIGUOUS");
            expect(() =>
              CorporateOnboardingModule.register(source, {
                ...input.onboarding,
                accountInventory: undefined as never,
              }),
            ).toThrow("CORPORATE_ONBOARDING_BINDINGS_REQUIRED");
            const instance = await NestFactory.create(PilotNonLocalApiModule.register(input), {
              logger: false,
              abortOnError: false,
            });
            await instance.listen(port, "127.0.0.1");
            return instance;
          };
          app = await boot();
          const api = (path: string, init: RequestInit = {}) =>
            fetch(`${origin}${path}`, {
              ...init,
              headers: { connection: "close", ...Object.fromEntries(new Headers(init.headers)) },
            });
          const root = `/api/v1/workspaces/${workspace}/projects`;
          expect((await api("/api/v1/auth/session")).status).toBe(401);
          expect((await api(root)).status).toBe(401);
          expect((await api("/local/personas")).status).toBe(404);
          const login = async (previous?: { cookie: string; csrfToken: string }) => {
            const begin = await api("/api/v1/auth/login", {
              method: "POST",
              headers: {
                origin,
                "content-type": "application/json",
                ...(previous
                  ? { cookie: previous.cookie, "x-csrf-token": previous.csrfToken }
                  : {}),
              },
              body: JSON.stringify({
                returnPath: "/pilot/readiness",
                ...(previous ? { stepUp: true } : {}),
              }),
            });
            expect(begin.status).toBe(200);
            const flowCookie = begin.headers.get("set-cookie")!.split(";")[0]!;
            const authorization = await fetch(
              ((await begin.json()) as { authorizationUrl: string }).authorizationUrl,
              { redirect: "manual" },
            );
            const callback = await fetch(authorization.headers.get("location")!, {
              headers: { cookie: flowCookie },
              redirect: "manual",
            });
            expect(callback.status).toBe(303);
            const cookie = callback.headers
              .getSetCookie()
              .find((value) => value.startsWith("awp-session="))!
              .split(";")[0]!;
            const response = await api("/api/v1/auth/session", { headers: { cookie } });
            expect(response.status).toBe(200);
            return {
              cookie,
              ...((await response.json()) as { csrfToken: string; stepUpAt?: string }),
            };
          };
          const reconfigure = async (projectIds: string[], roleKeys: string[]) => {
            await app!.close();
            app = undefined;
            const mappings = [{ group: "qa-team", workspaceId: workspace, projectIds, roleKeys }];
            const nextRef = {
              ...ref,
              version: ++policyVersion,
              contentHash: evidenceContentHash(mappings),
            };
            bindings = createCorporateSessionBindings({
              ...configuration,
              session: { ...configuration.session, policyRef: nextRef },
              groups: { ...configuration.groups, ref: nextRef, mappings },
            });
            app = await boot();
          };
          let session = await login();
          const headers = (extra: Record<string, string> = {}) => ({
            cookie: session.cookie,
            origin,
            "x-csrf-token": session.csrfToken,
            "content-type": "application/json",
            ...extra,
          });
          const registerBody = {
            key: "CORP008",
            name: "Corporate route project",
            ownerIds: Object.fromEntries(
              ["business", "technical", "qa", "security", "escalation"].map((role) => [
                role,
                human,
              ]),
            ),
            criticalityKey: "STANDARD",
            dataClassificationKey: "INTERNAL",
            reason: "HTTP registration proof",
          };
          const register = (body = registerBody, key = "register-corporate-008") =>
            api(root, {
              method: "POST",
              headers: headers({ "idempotency-key": key }),
              body: JSON.stringify(body),
            });
          expect(session.stepUpAt).toBeUndefined();
          const registrationOptions = await api(`${root}/registration-options`, {
            headers: { cookie: session.cookie },
          });
          expect(registrationOptions.status).toBe(200);
          expect(await registrationOptions.json()).toMatchObject({
            schemaVersion: 1,
            owners: expect.arrayContaining([
              { id: human, displayName: expect.any(String), username: null },
            ]),
          });
          expect((await register()).status).toBe(403);
          const ordinary = session;
          session = await login(ordinary);
          expect(session.stepUpAt).toBeDefined();
          expect(
            (await api("/api/v1/auth/session", { headers: { cookie: ordinary.cookie } })).status,
          ).toBe(401);
          // Core has an administrator row, but the narrowed IdP policy permits only executor roles.
          await reconfigure([randomUUID()], ["qa-executor"]);
          expect(
            (await api("/api/v1/auth/session", { headers: { cookie: session.cookie } })).status,
          ).toBe(401);
          session = await login(await login());
          expect((await register()).status).toBe(403);
          expect(
            (await api(`${root}/registration-options`, { headers: { cookie: session.cookie } }))
              .status,
          ).toBe(404);
          expect(
            await source.query("SELECT id FROM projects WHERE workspace_id=$1", [workspace]),
          ).toHaveLength(0);
          await reconfigure([randomUUID()], ["workspace-owner", "integration-administrator"]);
          session = await login(await login());
          let response = await api(root, { headers: { cookie: session.cookie } });
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ items: [] });
          expect(
            (
              await api(root, {
                method: "POST",
                headers: {
                  cookie: session.cookie,
                  origin,
                  "content-type": "application/json",
                  "idempotency-key": "csrf-negative",
                },
                body: JSON.stringify(registerBody),
              })
            ).status,
          ).toBe(403);
          response = await register();
          expect(response.status, await response.clone().text()).toBe(201);
          const registered = (await response.json()) as { projectId: string; version: number };
          expect(registered.version).toBe(1);
          const project = registered.projectId;
          expect((await register()).status).toBe(201);
          expect(
            await source.query("SELECT id FROM projects WHERE workspace_id=$1", [workspace]),
          ).toHaveLength(1);
          // Registration cannot silently enroll a generated project in the approved IdP mapping.
          expect(
            (await api(`${root}/${project}/onboarding`, { headers: { cookie: session.cookie } }))
              .status,
          ).toBe(404);
          await reconfigure([project], ["workspace-owner", "integration-administrator"]);
          session = await login(await login());
          response = await api(`${root}/${project}/onboarding`, {
            headers: { cookie: session.cookie },
          });
          expect(response.status).toBe(200);
          const grant = {
            principalId: human,
            operation: "GRANT",
            effect: "ALLOW",
            permissions,
            classificationCeilingKey: "INTERNAL",
            validFrom: new Date(Date.now() - 1000).toISOString(),
            reason: "Explicit scoped operating access",
          };
          const grantRequest = (body: unknown, key: string, version = 1) =>
            api(`${root}/${project}/entitlements`, {
              method: "POST",
              headers: headers({ "if-match": `"${version}"`, "idempotency-key": key }),
              body: JSON.stringify(body),
            });
          expect(
            (await grantRequest({ ...grant, actorId: recipient }, "forged-grant-008")).status,
          ).toBe(401);
          response = await grantRequest(grant, "valid-grant-008");
          expect(response.status, await response.clone().text()).toBe(201);
          const granted = (await response.json()) as {
            actor: { principalId: string };
            principalId: string;
          };
          expect(granted).toMatchObject({ actor: { principalId: human }, principalId: human });
          response = await api(`${root}/${project}/onboarding`, {
            headers: { cookie: session.cookie },
          });
          expect(response.status).toBe(200);
          const recipientGrant = await grantRequest(
            { ...grant, principalId: recipient, permissions: ["project.catalog.read"] },
            "recipient-grant-008",
            Number(response.headers.get("etag")!.replaceAll('"', "")),
          );
          expect(recipientGrant.status, await recipientGrant.clone().text()).toBe(201);
          expect(await recipientGrant.json()).toMatchObject({
            principalId: recipient,
            actor: { principalId: human },
          });
          response = await api(`${root}/${project}/onboarding`, {
            headers: { cookie: session.cookie },
          });
          expect(response.status).toBe(200);
          const version = Number(response.headers.get("etag")!.replaceAll('"', ""));
          await reconfigure([project], ["qa-executor"]);
          session = await login(await login());
          expect((await grantRequest(grant, "unmapped-owner-grant", version)).status).toBe(404);
          await reconfigure([project], ["workspace-owner", "integration-administrator"]);
          session = await login(await login());
          await source.query(
            "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'ACTIVE','INTERNAL',now())",
            [workItemId, workspace, project, workTypeId, human],
          );
          const material = await seedEvidenceHttpProject(
            source,
            directory,
            { workspaceId: workspace, projectId: project },
            workItemId,
            "INTERNAL",
            { principalId: human, workTypeId, crypto: evidenceCrypto },
          );
          const operations = `${root}/${project}/operations`;
          response = await api(`${operations}/suspend`, {
            method: "POST",
            headers: headers({
              "if-match": `"${version}"`,
              "idempotency-key": "suspend-corporate-008",
            }),
            body: JSON.stringify({
              incidentRef: "INC-008",
              reason: "Controlled recovery exercise",
            }),
          });
          expect(response.status, await response.clone().text()).toBe(200);
          const suspendedVersion = Number(response.headers.get("etag")!.replaceAll('"', ""));
          expect(await response.json()).toMatchObject({ operationalState: "SUSPENDED" });
          expect(await source.query("SELECT state FROM projects WHERE id=$1", [project])).toEqual([
            { state: "ACTIVE" },
          ]);
          response = await api(`${operations}/incident-dispositions`, {
            method: "POST",
            headers: headers({
              "if-match": `"${suspendedVersion}"`,
              "idempotency-key": "disposition-corporate-008",
            }),
            body: JSON.stringify({
              incidentRef: "INC-008",
              outcome: "ACCEPTED",
              reason: "Incident investigated",
            }),
          });
          expect(response.status, await response.clone().text()).toBe(202);
          expect(
            await source.query(
              "SELECT actor_id FROM project_incident_dispositions WHERE project_id=$1",
              [project],
            ),
          ).toEqual([{ actor_id: human }]);
          const evaluation = {
            gateKind: "L0",
            projectRegistryRef: ref,
            bindingRef: ref,
            qaProjectContextRef: ref,
            starterEntitlementSetHash: ref.contentHash,
            requestedCapabilityMode: "MANUAL_ONLY",
          };
          expect(
            (
              await api(`${root}/${project}/onboarding/evaluations`, {
                method: "POST",
                headers: headers({
                  "if-match": `"${suspendedVersion}"`,
                  "idempotency-key": "suspended-mutation-008",
                }),
                body: JSON.stringify(evaluation),
              })
            ).status,
          ).toBe(404);
          const evidence = `/v1/workspaces/${workspace}/projects/${project}/evidence`;
          const verify = () =>
            api(`${evidence}/manifests/${material.manifest.manifestId}/verify?revision=1`, {
              method: "POST",
              headers: headers(),
            });
          response = await verify();
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            integrity: "PASS",
            signature: "PASS",
            keyStatus: "PINNED_TRUSTED",
          });
          expect(
            vault.requests.filter((request) => request.path === "/v1/transit/sign/evidence"),
          ).toHaveLength(1);
          const tampered = await seedEvidenceHttpProject(
            source,
            directory,
            { workspaceId: workspace, projectId: project },
            workItemId,
            "INTERNAL",
            { principalId: human, workTypeId, crypto: evidenceCrypto, tamperSignature: true },
          );
          response = await api(
            `${evidence}/manifests/${tampered.manifest.manifestId}/verify?revision=1`,
            { method: "POST", headers: headers() },
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            integrity: "PASS",
            signature: "FAIL",
            safeIssueCodes: ["EVIDENCE_SIGNATURE_INVALID"],
          });
          expect(
            (
              await api(`${evidence}/manifests/${material.manifest.manifestId}/verify?revision=1`, {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ principalId: recipient }),
              })
            ).status,
          ).toBe(401);
          const exportPath = `${evidence}/packages/${material.evidencePackage.packageId}/exports`;
          const exportBody = {
            packageVersion: 1,
            redactionPolicyRef: evidenceCrypto({ workspaceId: workspace, projectId: project })
              .redactionPolicyRef,
            format: "JSON",
            reason: "Controlled evidence inspection",
          };
          const exportRequest = () =>
            api(exportPath, {
              method: "POST",
              headers: headers({ "idempotency-key": "corporate-export-008" }),
              body: JSON.stringify(exportBody),
            });
          response = await exportRequest();
          expect(response.status, await response.clone().text()).toBe(202);
          const receipt = (await response.json()) as { resultRef: { id: string }; state: string };
          expect(receipt.state).toBe("COMPLETED");
          expect(await (await exportRequest()).json()).toEqual(receipt);
          await app.close();
          app = undefined;
          app = await boot();
          response = await api(`${evidence}/exports/${receipt.resultRef.id}`, {
            headers: { cookie: session.cookie },
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            packageId: material.evidencePackage.packageId,
            manifestRevisionRefs: material.evidencePackage.manifestRevisionRefs,
          });
          expect(
            await source.query(
              "SELECT requested_by FROM evidence_export_records WHERE project_id=$1",
              [project],
            ),
          ).toEqual([{ requested_by: expect.objectContaining({ principalId: human }) }]);
          expect(
            await source.query(
              "SELECT id FROM audit_events WHERE project_id=$1 AND action='qa.evidence.export'",
              [project],
            ),
          ).toHaveLength(1);
          expect((await verify()).status).toBe(200);
          vault.state.status = 503;
          response = await verify();
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ signature: "PASS" });
          await source.query(
            "UPDATE workspace_memberships SET revoked_at=now() WHERE workspace_id=$1 AND principal_id=$2",
            [workspace, human],
          );
          expect(
            (await api(`${root}/${project}/onboarding`, { headers: { cookie: session.cookie } }))
              .status,
          ).toBe(404);
          expect(
            (await register({ ...registerBody, key: "REVOKED008" }, "revoked-register-008")).status,
          ).toBe(403);
          expect(
            await source.query("SELECT id FROM projects WHERE workspace_id=$1", [workspace]),
          ).toHaveLength(1);
        } finally {
          await app?.close();
          if (source.isInitialized) await source.destroy();
          await idp.stop();
          await vault.stop();
          await postgres.stop();
          await rm(directory, { recursive: true, force: true });
        }
      },
      120_000,
    );
  },
);
