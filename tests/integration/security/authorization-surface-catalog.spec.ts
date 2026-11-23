import { describe, expect, it } from "vitest";

import { authorizationCatalog } from "../../../packages/platform-runtime-nest/src/auth/authorization-catalog.ts";
import { REQUIRED_PERMISSION } from "../../../packages/platform-runtime-nest/src/auth/authorize-use-case.interceptor.ts";
import { ArtifactsController } from "../../../packages/platform-runtime-nest/src/http/artifacts.controller.ts";
import { AuditController } from "../../../packages/platform-runtime-nest/src/http/audit.controller.ts";
import { ControlPlaneController } from "../../../packages/platform-runtime-nest/src/http/control-plane.controller.ts";
import { ExtensionRegistryController } from "../../../packages/platform-runtime-nest/src/http/extension-registry.controller.ts";
import { IntakeDraftsController } from "../../../packages/platform-runtime-nest/src/http/intake-drafts.controller.ts";
import { IntegrationRegistryController } from "../../../packages/platform-runtime-nest/src/http/integration-registry.controller.ts";
import { ProjectsController } from "../../../packages/platform-runtime-nest/src/http/projects.controller.ts";
import { WorkItemsController } from "../../../packages/platform-runtime-nest/src/http/work-items.controller.ts";
import { WorkTypesController } from "../../../packages/platform-runtime-nest/src/http/work-types.controller.ts";

const controllers = [
  ExtensionRegistryController,
  ProjectsController,
  WorkTypesController,
  IntakeDraftsController,
  WorkItemsController,
  IntegrationRegistryController,
  ControlPlaneController,
  AuditController,
  ArtifactsController,
] as const;

describe("explicit authorization surface catalog", () => {
  it("catalogs every registry/work/configuration/command/approval/audit/artifact handler", () => {
    const catalogOperations = new Set(authorizationCatalog.map(({ operation }) => operation));
    const handlerOperations = controllers.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter(
          (method) =>
            method !== "constructor" &&
            typeof Object.getOwnPropertyDescriptor(controller.prototype, method)?.value ===
              "function",
        )
        .map((method) => `${controller.name}.${method}`),
    );

    expect([...catalogOperations].sort()).toEqual(handlerOperations.sort());
    expect(catalogOperations.size).toBe(authorizationCatalog.length);
    expect(new Set(authorizationCatalog.map(({ surface }) => surface))).toEqual(
      new Set([
        "REGISTRY",
        "WORK",
        "CONFIGURATION",
        "COMMAND",
        "APPROVAL",
        "AUDIT",
        "ARTIFACT",
        "WEBHOOK",
      ]),
    );
  });

  it("keeps each catalog permission equal to the interceptor metadata", () => {
    for (const controller of controllers) {
      for (const method of Object.getOwnPropertyNames(controller.prototype).filter(
        (value) => value !== "constructor",
      )) {
        const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, method);
        if (typeof descriptor?.value !== "function") continue;
        const operation = `${controller.name}.${method}`;
        const catalog = authorizationCatalog.find((candidate) => candidate.operation === operation);
        expect(catalog, `${operation} missing from authorization catalog`).toBeDefined();
        expect(Reflect.getMetadata(REQUIRED_PERMISSION, descriptor.value)).toBe(
          catalog?.permission,
        );
      }
    }
  });
});
