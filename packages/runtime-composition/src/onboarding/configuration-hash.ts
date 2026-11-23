import type { JsonValue } from "@awp/platform-contracts";
import { pilotContentHash, semanticContentHash } from "@awp/platform-core";

/** Core revisions hash their semantic fields; runtime publications hash the document. */
export function integrationConfigurationHash(
  kind: "project_integration_binding" | "connector_profile" | "connection" | "connector_mapping",
  content: Record<string, unknown>,
): string {
  if (!content.revisionId) return pilotContentHash(content);
  const keys =
    kind === "project_integration_binding"
      ? ["key", "dataClassificationKey", "entries", "configurationRefs", "resourceRefs"]
      : kind === "connector_profile"
        ? [
            "key",
            "connectorRef",
            "connectionRef",
            "mappingRef",
            "dataClassificationKey",
            "capabilityConfigurations",
            "profileConfiguration",
          ]
        : kind === "connection"
          ? [
              "key",
              "connectorRef",
              "environmentClass",
              "endpoint",
              "serviceIdentitySecretRef",
              "quarantineClassificationKey",
              "dataClassificationKey",
              "connectorConfiguration",
            ]
          : ["key", "connectorRef", "mapping", "dataClassificationKey"];
  const semantic = Object.fromEntries(
    keys.filter((key) => content[key] !== undefined).map((key) => [key, content[key]]),
  );
  if (kind === "project_integration_binding") {
    semantic.configurationRefs ??= [];
    semantic.resourceRefs ??= [];
  }
  return semanticContentHash(semantic as JsonValue);
}
