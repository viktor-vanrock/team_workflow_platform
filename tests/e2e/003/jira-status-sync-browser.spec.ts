import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";

let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  const entry = resolve("tests/e2e/003/virtual-jira-sync-entry.tsx");
  server = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
    plugins: [
      {
        name: "jira-sync-test-view",
        resolveId(id) {
          if (id === "/__jira_sync_entry.tsx") return entry;
          return undefined;
        },
        load(id) {
          if (id !== entry) return;
          return `import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { QaOperationalAuthorityWorkspace } from ${JSON.stringify(resolve("packages/competency-qa/src/ui/operational-authority-workspace.tsx"))};
          createRoot(document.getElementById('root')).render(React.createElement(QaOperationalAuthorityWorkspace, {
            workspaceId: 'workspace', projectId: 'project', workItemId: 'work-item', apiUrl: '', accessToken: 'test',
            permissions: ['command.execute', 'integration.use']
          }));`;
        },
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== "/__jira_sync") return next();
            void vite
              .transformIndexHtml(
                "/__jira_sync",
                '<html><body><div id="root"></div><script type="module" src="/__jira_sync_entry.tsx"></script></body></html>',
              )
              .then((html) => {
                response.setHeader("content-type", "text/html");
                response.end(html);
              })
              .catch(next);
          });
        },
      },
    ],
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await server?.close();
});

test("refreshes Jira status without a click and shows synchronization failures", async ({
  page,
}) => {
  let reads = 0;
  let responseStatus = 200;
  let projection = {
    acceptance_source: "VERIFIED_IMPORT",
    current_external_display_key: "QAC-1",
    freshness_state: "CURRENT",
    sync_state: "SYNCED",
    projection_revision: 1,
    last_observed_at: "2026-09-10T10:00:00.000Z",
    authority_snapshot: { rawStatus: { id: "1", name: "Open" }, normalizedStatus: "NEW" },
  };
  await page.route("**/api/v1/**/projection", (route) => {
    reads += 1;
    return route.fulfill({ status: responseStatus, json: projection });
  });
  await page.goto(`${origin}/__jira_sync`);
  await expect(page.getByText("Статус Jira: Open", { exact: true })).toBeVisible();
  await expect(page.getByText(/Последняя проверка Jira:/u)).toBeVisible();
  projection = {
    ...projection,
    projection_revision: 2,
    authority_snapshot: { rawStatus: { id: "2", name: "Done" }, normalizedStatus: "DONE" },
  };
  await expect(page.getByText("Статус Jira: Done", { exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await expect(page.getByText("Статус запроса: Выполнено", { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
  projection = { ...projection, sync_state: "MAPPING_REQUIRED", freshness_state: "STALE" };
  await expect(page.getByText(/В Jira появился неизвестный статус/u)).toBeVisible({
    timeout: 12_000,
  });
  await expect(page.getByText("Статус Jira: Done", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Перевести в состояние «Выполнено»" }),
  ).toBeDisabled();
  responseStatus = 503;
  await expect(page.getByText(/Не удалось загрузить рабочую проекцию: 503/u)).toBeVisible({
    timeout: 12_000,
  });
  responseStatus = 200;
  projection = { ...projection, sync_state: "SYNCED", freshness_state: "CURRENT" };
  await expect(page.getByText(/Не удалось загрузить рабочую проекцию: 503/u)).toHaveCount(0, {
    timeout: 12_000,
  });
  await expect(page.getByText(/В Jira появился неизвестный статус/u)).toHaveCount(0);
});
