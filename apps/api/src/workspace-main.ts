import "reflect-metadata";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import {
  ProblemDetailsFilter,
  runSafeRuntimeEntrypoint,
  SafeNestLogger,
} from "@awp/platform-runtime-nest";
import {
  createHermesDialogueClient,
  createWorkspaceInstallationDataSource,
  loadWorkspaceInstallationConfig,
  workspaceInstallationReadiness,
  workspaceInstallationSessions,
} from "@awp/runtime-composition";

import { WorkspaceInstallationModule } from "./workspace/workspace.module.ts";

/** Deployable initial workspace host, separate from the provider-enabled pilot runtime. */
export async function bootstrapWorkspaceApplication(env = process.env) {
  const config = loadWorkspaceInstallationConfig(env);
  const hermes = createHermesDialogueClient(env, true);
  const source = createWorkspaceInstallationDataSource(env);
  let app: NestExpressApplication | undefined;
  try {
    await source.initialize();
    const readiness = await workspaceInstallationReadiness(source);
    if (!readiness.ready) throw new Error(readiness.reasonCode);
    const { sessions } = workspaceInstallationSessions(source, config, env);
    app = await NestFactory.create<NestExpressApplication>(
      WorkspaceInstallationModule.register(source, sessions, true, hermes),
      {
        logger: new SafeNestLogger("api"),
        abortOnError: false,
      },
    );
    app.useGlobalFilters(new ProblemDetailsFilter());
    app.enableShutdownHooks();
    // The static web and cookie BFF share one origin. Only explicit UI paths get SPA fallback.
    const webRoot = resolve(
      env.AWP_WORKSPACE_WEB_ROOT ?? resolve(import.meta.dirname, "../../../dist/apps/web"),
    );
    if (!existsSync(resolve(webRoot, "index.html")))
      throw new Error("WORKSPACE_WEB_BUILD_REQUIRED");
    app.useStaticAssets(webRoot, { index: false });
    for (const path of [
      "/",
      "/access",
      "/admin/users",
      "/projects",
      "/projects/new",
      "/projects/hermes",
      "/projects/:projectId/edit",
    ])
      app
        .getHttpAdapter()
        .get(path, (_request: unknown, response: { sendFile(path: string): void }) =>
          response.sendFile(resolve(webRoot, "index.html")),
        );
    const port = Number(env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("WORKSPACE_PORT_INVALID");
    await app.listen(port, "0.0.0.0");
    return app;
  } catch (error) {
    await app?.close();
    if (source.isInitialized) await source.destroy();
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (
    !(await runSafeRuntimeEntrypoint("api", async () => {
      await bootstrapWorkspaceApplication();
    }))
  )
    process.exitCode = 1;
}
