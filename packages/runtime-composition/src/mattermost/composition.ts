import {
  mattermostConnectorManifest,
  mattermostIngressDeclarations,
} from "@awp/connector-mattermost";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { createMattermostIngressRegistry } from "./ingress-handlers.ts";
import { ComposedMattermostProfileValidator } from "./profile-validation.ts";

export function createMattermostComposition(environment: RuntimeEnvironment) {
  if (environment.environmentScope === "PLATFORM_PROD")
    throw new Error("MATTERMOST_PRODUCTION_FORBIDDEN");
  return Object.freeze({
    manifest: mattermostConnectorManifest,
    ingressDeclarations: mattermostIngressDeclarations,
    ingress: createMattermostIngressRegistry(),
    profileValidation: new ComposedMattermostProfileValidator(environment),
    environmentScope: environment.environmentScope,
  });
}
