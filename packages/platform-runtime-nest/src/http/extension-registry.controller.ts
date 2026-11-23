import { Controller, Get } from "@nestjs/common";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";

export abstract class ExtensionRegistryQueries {
  abstract listPacks(): Promise<readonly unknown[]>;
  abstract listConnectors(): Promise<readonly unknown[]>;
  abstract listCapabilities(): Promise<readonly unknown[]>;
}
@Controller("extension-registry")
export class ExtensionRegistryController {
  constructor(private readonly queries: ExtensionRegistryQueries) {}
  @Get("packs") @RequirePermission("extension-registry.read") listPackRegistrations() {
    return this.queries.listPacks();
  }
  @Get("connectors") @RequirePermission("extension-registry.read") listConnectorRegistrations() {
    return this.queries.listConnectors();
  }
  @Get("capabilities") @RequirePermission("extension-registry.read") listCapabilityContracts() {
    return this.queries.listCapabilities();
  }
}
