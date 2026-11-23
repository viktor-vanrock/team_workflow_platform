import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Browser, chromium } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";

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
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { startEvidenceHttpFixture } from "../../support/007-evidence-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({})
class EvidenceBrowserProofModule {}

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 evidence browser with real API and PostgreSQL",
  () => {
    it("checks a signed revision and downloads one audited export despite a repeated click", async () => {
      const f = await startEvidenceHttpFixture(POSTGRES_TEST_IMAGES[1]);
      let api: NestExpressApplication | undefined,
        web: ViteDevServer | undefined,
        browser: Browser | undefined;
      try {
        const identity: QaHttpIdentity = {
          authenticate: async (context) => {
            if (
              context.switchToHttp().getRequest<{ headers: { authorization?: string } }>().headers
                .authorization !== "Bearer controlled-browser-session"
            )
              throw new Error("NO_IDENTITY");
            return async ({ scope, permission }) => ({
              ...(await authorizeLocalQaApi(
                f.source,
                { headers: {}, localPersonaKey: "lead.alpha" },
                scope.workspaceId,
                scope.projectId,
                permission,
              )),
              authentication: {
                contextRef: "controlled-browser-session",
                verifiedAt: new Date().toISOString(),
                stepUpAt: new Date().toISOString(),
              },
            });
          },
        };
        api = await NestFactory.create<NestExpressApplication>(
          {
            module: EvidenceBrowserProofModule,
            controllers: [EvidenceIntegrityController],
            providers: [
              QaSessionGuard,
              { provide: QA_DATA_SOURCE, useValue: f.source },
              { provide: QA_HTTP_IDENTITY, useValue: identity },
              {
                provide: EVIDENCE_HTTP_APPLICATION,
                useValue: new DurableEvidenceHttpApplication(f.source, f.crypto),
              },
            ],
          },
          { logger: false, abortOnError: false },
        );
        api.enableCors({ origin: /^http:\/\/127\.0\.0\.1:[0-9]+$/u });
        await api.listen(0, "127.0.0.1");
        const props = {
          apiUrl: await api.getUrl(),
          accessToken: "controlled-browser-session",
          ...f.scope,
        };
        web = await createServer({
          configFile: resolve("apps/web/vite.config.ts"),
          logLevel: "error",
          server: { host: "127.0.0.1", port: 0 },
          plugins: [
            {
              name: "evidence-browser-proof",
              resolveId(id) {
                if (id === "/evidence-proof.tsx") return "\0evidence-proof.tsx";
                return undefined;
              },
              load(id) {
                if (id === "\0evidence-proof.tsx")
                  return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProjectEvidenceRoute} from '/src/routes/projects/evidence.tsx'; createRoot(document.getElementById('root')).render(React.createElement(ProjectEvidenceRoute, ${JSON.stringify(props)}));`;
                return undefined;
              },
              configureServer(server) {
                server.middlewares.use((request, response, next) => {
                  if (request.url !== "/__evidence-proof") return next();
                  response.setHeader("content-type", "text/html");
                  void server
                    .transformIndexHtml(
                      "/__evidence-proof",
                      '<!doctype html><html><body><div id="root"></div><script type="module" src="/evidence-proof.tsx"></script></body></html>',
                    )
                    .then((html) => response.end(html))
                    .catch(next);
                });
              },
            },
          ],
        });
        await web.listen();
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${web.resolvedUrls!.local[0]}__evidence-proof`);
        await expect
          .poll(async () => errors.length > 0 || (await page.locator("main").count()) > 0, {
            timeout: 20_000,
          })
          .toBe(true);
        expect(errors).toEqual([]);
        await page.getByRole("textbox", { name: /^ID манифеста/u }).fill(f.manifest.manifestId);
        await page.getByRole("button", { name: "Проверить материалы", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "подпись — Пройдено" }).waitFor();
        await page
          .getByRole("textbox", { name: /^ID пакета подтверждающих материалов/u })
          .fill(f.evidencePackage.packageId);
        await page
          .getByRole("textbox", { name: /^Причина экспорта/u })
          .fill("Передача аудита из браузера");
        for (let attempt = 0; attempt < 2; attempt++) {
          const pending = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "Экспортировать проверенные материалы", exact: true })
            .click();
          const download = await pending,
            path = await download.path();
          if (!path) throw new Error("DOWNLOAD_MISSING");
          const payload = JSON.parse(await readFile(path, "utf8")) as {
            packageId: string;
            contentHash: string;
          };
          expect(payload.packageId).toBe(f.evidencePackage.packageId);
          expect(payload.contentHash).toBe(f.evidencePackage.contentHash);
          expect(JSON.stringify(payload)).not.toMatch(
            /https?:|opaqueLocator|secretRef|credential/u,
          );
          await page
            .getByRole("alert")
            .filter({ hasText: "экспорт записан в журнал аудита" })
            .waitFor();
        }
        expect(
          await f.source.query("SELECT count(*)::int AS count FROM evidence_export_records"),
        ).toEqual([{ count: 1 }]);
        expect(
          await f.source.query(
            "SELECT count(*)::int AS count FROM audit_events WHERE action='qa.evidence.export'",
          ),
        ).toEqual([{ count: 1 }]);
        expect(errors).toEqual([]);
      } finally {
        await browser?.close();
        await web?.close();
        await api?.close();
        await f.close();
      }
    }, 180_000);
  },
);
