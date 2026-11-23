import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import { Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import {
  DurableEvidenceHttpApplication,
  EVIDENCE_HTTP_APPLICATION,
} from "../../../apps/api/src/extensions/onboarding/evidence.application.ts";
import { EvidenceIntegrityController } from "../../../apps/api/src/extensions/onboarding/evidence.controller.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  createLocalEvidenceCrypto,
  localEvidencePolicies,
} from "../../../apps/api/src/local/local-evidence-integrity.ts";
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { FilePublicKeyHistory } from "../../../packages/runtime-composition/src/security/public-key-history.ts";
import { localSeedIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startEvidenceHttpFixture } from "../../support/007-evidence-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({})
class EvidenceProofModule {}

describe("007 evidence HTTP authority", () => {
  it("requires verified identity on the published verification route", async () => {
    const app = await NestFactory.create(
      {
        module: EvidenceProofModule,
        controllers: [EvidenceIntegrityController],
        providers: [
          QaSessionGuard,
          { provide: QA_DATA_SOURCE, useValue: {} },
          { provide: EVIDENCE_HTTP_APPLICATION, useValue: {} },
          {
            provide: QA_HTTP_IDENTITY,
            useValue: {
              authenticate: async () => {
                throw new Error("NO_SESSION");
              },
            },
          },
        ],
      },
      { logger: false, abortOnError: false },
    );
    try {
      await app.listen(0, "127.0.0.1");
      const response = await fetch(
        `${await app.getUrl()}/v1/workspaces/10000000-0000-4000-8000-000000000001/projects/20000000-0000-4000-8000-000000000001/evidence/manifests/40000000-0000-4000-8000-000000000001/verify?revision=1`,
        { method: "POST", headers: { connection: "close" } },
      );
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain("VALID");
    } finally {
      await app.close();
    }
  });
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")("007 durable evidence HTTP", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "verifies, corrects and exports exact persisted evidence across restart on %s",
    async (image) => {
      const f = await startEvidenceHttpFixture(image);
      let app: NestExpressApplication | undefined,
        origin = "",
        available = true,
        failAfterSigning = false,
        keyAvailable = true;
      const path = `/v1/workspaces/${f.scope.workspaceId}/projects/${f.scope.projectId}/evidence`;
      const identity: QaHttpIdentity = {
        // Controlled verified identity isolates this API/DB journey; the real OIDC/CSRF adapter has its own suite.
        authenticate: async (context) => {
          const token = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>()
            .headers.authorization;
          if (
            !token ||
            !["Bearer owner", "Bearer no-mfa", "Bearer lower-clearance"].includes(token)
          )
            throw new Error("NO_IDENTITY");
          return async ({ scope, permission }) => {
            if (!available) throw new Error("REVOKED");
            const result = await authorizeLocalQaApi(
              f.source,
              { headers: {}, localPersonaKey: "lead.alpha" },
              scope.workspaceId,
              scope.projectId,
              permission,
            );
            return {
              ...result,
              ...(token === "Bearer lower-clearance"
                ? { classificationCeiling: "PUBLIC" as const }
                : {}),
              authentication: {
                contextRef: "controlled-verified-session",
                verifiedAt: new Date().toISOString(),
                ...(token === "Bearer no-mfa" ? {} : { stepUpAt: new Date().toISOString() }),
              },
            };
          };
        },
      };
      const boot = async () => {
        const freshCrypto = createLocalEvidenceCrypto(f.directory);
        const application = new DurableEvidenceHttpApplication(f.source, (scope) => {
          const crypto = freshCrypto(scope),
            history = new FilePublicKeyHistory(f.directory, scope, () => keyAvailable);
          return {
            ...crypto,
            verify: (manifest, envelope) => history.verify(manifest, envelope),
            signManifest: async (manifest) => {
              const signed = await crypto.signManifest(manifest);
              if (failAfterSigning) available = false;
              return signed;
            },
          };
        });
        app = await NestFactory.create<NestExpressApplication>(
          {
            module: EvidenceProofModule,
            controllers: [EvidenceIntegrityController],
            providers: [
              QaSessionGuard,
              { provide: QA_DATA_SOURCE, useValue: f.source },
              { provide: QA_HTTP_IDENTITY, useValue: identity },
              { provide: EVIDENCE_HTTP_APPLICATION, useValue: application },
            ],
          },
          { logger: false, abortOnError: false },
        );
        await app.listen(0, "127.0.0.1");
        origin = await app.getUrl();
      };
      const api = async (suffix: string, init: RequestInit = {}) => {
        const headers = new Headers({
          authorization: "Bearer owner",
          "content-type": "application/json",
          connection: "close",
        });
        new Headers(init.headers).forEach((value, key) => {
          headers.set(key, value);
        });
        const response = await fetch(`${origin}${path}/${suffix}`, { ...init, headers });
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
          headers: response.headers,
        };
      };
      const correction = (key: string, etag = '"1"', extra: Record<string, unknown> = {}) =>
        api(`manifests/${f.manifest.manifestId}/corrections`, {
          method: "POST",
          headers: { "idempotency-key": key, "if-match": etag },
          body: JSON.stringify({ kind: "CLERICAL", reason: "Clarified attestation", ...extra }),
        });
      try {
        await boot();
        const verified = await api(`manifests/${f.manifest.manifestId}/verify?revision=1`, {
          method: "POST",
        });
        expect(verified).toMatchObject({
          status: 200,
          body: { integrity: "PASS", signature: "PASS", keyStatus: "PINNED_TRUSTED" },
        });
        expect(verified.headers.get("cache-control")).toBe("private, no-store");
        expect((await api(`packages/${f.evidencePackage.packageId}`)).status).toBe(200);
        expect(
          (
            await api(`manifests/${f.manifest.manifestId}/verify?revision=1`, {
              method: "POST",
              headers: { authorization: "Bearer lower-clearance" },
            })
          ).status,
        ).toBe(404);
        const spy = vi.spyOn(f.source, "query");
        const cross = await fetch(
          `${origin}${path.replace(f.scope.projectId, localSeedIds.beta)}/packages/${f.evidencePackage.packageId}`,
          { headers: { authorization: "Bearer owner", connection: "close" } },
        );
        expect(cross.status).toBe(404);
        spy.mockRestore();
        expect(
          (await api(`manifests/${f.manifest.manifestId}/verify?revision=0`, { method: "POST" }))
            .status,
        ).toBe(400);
        keyAvailable = false;
        expect(
          (await api(`manifests/${f.manifest.manifestId}/verify?revision=1`, { method: "POST" }))
            .body,
        ).toMatchObject({
          signature: "FAIL",
          keyStatus: "UNKNOWN",
          safeIssueCodes: ["EVIDENCE_KEY_UNAVAILABLE"],
        });
        keyAvailable = true;

        expect((await correction("weak-tag-1", 'W/"1"')).status).toBe(400);
        expect(
          (await correction("bad-kind-1", '"1"', { actor: { principalId: "forged" } })).status,
        ).toBe(401);
        const corrected = await correction("correction-1");
        expect(corrected.status).toBe(202);
        expect(corrected.body.state).toBe("COMPLETED");
        expect((await correction("stale-request", '"1"')).status).toBe(409);
        expect(
          (await correction("correction-1", '"1"', { reason: "Changed request" })).status,
        ).toBe(409);
        expect(
          (await api(`manifests/${f.manifest.manifestId}/verify?revision=2`, { method: "POST" }))
            .body.signature,
        ).toBe("PASS");
        expect(
          await f.source.query(
            "SELECT semantic_body FROM qa_evidence_manifest_revisions_v2 WHERE manifest_revision_id=$1",
            [f.manifest.manifestRevisionId],
          ),
        ).toEqual([{ semantic_body: f.manifest }]);
        await app!.close();
        app = undefined;
        await f.source.destroy();
        await f.source.initialize();
        await boot();
        expect((await correction("correction-1")).body).toEqual(corrected.body);
        const racing = await Promise.all([
          correction("race-request-1", '"2"'),
          correction("race-request-2", '"2"'),
        ]);
        expect(racing.map((r) => r.status).sort()).toEqual([202, 409]);

        failAfterSigning = true;
        expect((await correction("revoke-during-sign", '"3"')).status).toBe(404);
        failAfterSigning = false;
        available = true;
        expect(
          await f.source.query(
            "SELECT current_revision FROM qa_evidence_manifest_headers_v2 WHERE manifest_id=$1",
            [f.manifest.manifestId],
          ),
        ).toEqual([{ current_revision: 3 }]);
        await f.source.query(
          "CREATE FUNCTION evidence_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled audit failure'; END $$; CREATE TRIGGER evidence_test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.action='qa.evidence.correct') EXECUTE FUNCTION evidence_test_audit_failure()",
        );
        expect((await correction("audit-failure-1", '"3"')).status).toBe(503);
        await f.source.query(
          "DROP TRIGGER evidence_test_audit_failure ON audit_events; DROP FUNCTION evidence_test_audit_failure()",
        );
        expect(
          await f.source.query(
            "SELECT count(*)::int AS count FROM qa_evidence_manifest_revisions_v2",
          ),
        ).toEqual([{ count: 3 }]);
        expect(
          await f.source.query(
            "SELECT count(*)::int AS count FROM qa_evidence_signature_envelopes",
          ),
        ).toEqual([{ count: 3 }]);
        expect(
          await f.source.query(
            "SELECT count(*)::int AS count FROM client_request_idempotency WHERE operation='evidence.correct'",
          ),
        ).toEqual([{ count: 2 }]);
        expect(
          await f.source.query(
            "SELECT current_revision FROM qa_evidence_manifest_headers_v2 WHERE manifest_id=$1",
            [f.manifest.manifestId],
          ),
        ).toEqual([{ current_revision: 3 }]);

        const exportBody = {
          packageVersion: 1,
          redactionPolicyRef: localEvidencePolicies.redactionPolicyRef,
          format: "JSON",
          reason: "Audit handoff",
        };
        expect((await api("export-options")).body).toMatchObject({
          formats: ["JSON"],
          redactionPolicyRef: localEvidencePolicies.redactionPolicyRef,
          stepUpRequired: true,
        });
        const exportRequest = (headers: Record<string, string> = {}, body = exportBody) =>
          api(`packages/${f.evidencePackage.packageId}/exports`, {
            method: "POST",
            headers: { "idempotency-key": "export-request-1", ...headers },
            body: JSON.stringify(body),
          });
        expect((await exportRequest({ authorization: "Bearer no-mfa" })).status).toBe(403);
        expect(
          (
            await exportRequest(
              {},
              {
                ...exportBody,
                redactionPolicyRef: { ...localEvidencePolicies.redactionPolicyRef, version: 2 },
              },
            )
          ).status,
        ).toBe(422);
        const exported = await exportRequest();
        expect(exported.status).toBe(202);
        const exportId = exported.body.commandId as string;
        const payload = await api(`exports/${exportId}`);
        expect(payload.status).toBe(200);
        expect(payload.body.packageId).toBe(f.evidencePackage.packageId);
        expect(JSON.stringify(payload.body)).not.toMatch(
          /https?:|opaqueLocator|secretRef|credential/u,
        );
        await app!.close();
        app = undefined;
        await f.source.destroy();
        await f.source.initialize();
        await boot();
        expect((await exportRequest()).body).toEqual(exported.body);
        expect((await api(`exports/${exportId}`)).body).toEqual(payload.body);
        expect(
          await f.source.query("SELECT count(*)::int AS count FROM evidence_export_records"),
        ).toEqual([{ count: 1 }]);
        expect(
          await f.source.query(
            "SELECT action,count(*)::int AS count FROM audit_events WHERE action IN ('qa.evidence.correct','qa.evidence.export') GROUP BY action ORDER BY action",
          ),
        ).toEqual([
          { action: "qa.evidence.correct", count: 2 },
          { action: "qa.evidence.export", count: 1 },
        ]);
        await f.source.query(
          "UPDATE qa_project_context_headers_v2 SET current_published_version=NULL WHERE context_id=$1",
          [f.contextId],
        );
        expect((await api(`exports/${exportId}`)).status).toBe(422);
        await f.source.query(
          "UPDATE qa_project_context_headers_v2 SET current_published_version=1 WHERE context_id=$1",
          [f.contextId],
        );
        await f.source.query(
          "UPDATE project_entitlements SET revoked_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
          [f.scope.workspaceId, f.scope.projectId, f.evidencePackage.createdBy.principalId],
        );
        expect((await exportRequest()).status).toBe(404);
        expect((await api(`exports/${exportId}`)).status).toBe(404);
      } finally {
        await app?.close();
        await f.close();
      }
    },
    180_000,
  );
  it("reports a cryptographically invalid stored signature as FAIL and refuses package access", async () => {
    const f = await startEvidenceHttpFixture(POSTGRES_TEST_IMAGES[1], { tamperSignature: true });
    const access = await authorizeLocalQaApi(
      f.source,
      { headers: {}, localPersonaKey: "lead.alpha" },
      f.scope.workspaceId,
      f.scope.projectId,
      "qa.evidence.verify",
    );
    const application = new DurableEvidenceHttpApplication(f.source, f.crypto),
      request = { ...f.scope, authorize: async () => access };
    try {
      expect(
        await application.verify({ ...request, manifestId: f.manifest.manifestId, revision: 1 }),
      ).toMatchObject({
        integrity: "PASS",
        signature: "FAIL",
        safeIssueCodes: ["EVIDENCE_SIGNATURE_INVALID"],
      });
      await expect(
        application.getPackage({ ...request, packageId: f.evidencePackage.packageId }),
      ).rejects.toThrow("EVIDENCE_PACKAGE_SIGNATURE_INVALID");
      expect(
        await f.source.query("SELECT count(*)::int AS count FROM evidence_export_records"),
      ).toEqual([{ count: 0 }]);
    } finally {
      await f.close();
    }
  }, 120_000);
});
