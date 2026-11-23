import type { JiraAdapterFamily } from "@awp/platform-contracts";

export interface JiraBootstrapConnection {
  readonly id: string;
  readonly version: number;
  readonly family: JiraAdapterFamily;
  readonly exactBuild: string;
  readonly baseUrl: string;
  readonly stage: "BOOTSTRAP";
}
export interface JiraDiscoveryRecord {
  readonly connectionId: string;
  readonly connectionVersion: number;
  readonly contentHash: string;
  readonly capabilities: Readonly<Record<string, boolean>>;
}
export interface JiraValidatedConnection extends Omit<JiraBootstrapConnection, "stage"> {
  readonly stage: "VALIDATED";
  readonly discoveryHash: string;
}
export interface JiraPublishedProfile {
  readonly id: string;
  readonly version: number;
  readonly connection: JiraValidatedConnection;
  readonly contentHash: string;
  readonly mappingHash: string;
  readonly state: "PUBLISHED";
}

export class JiraConfigurationLifecycle {
  readonly #profiles = new Map<string, JiraPublishedProfile>();
  readonly #drift = new Map<string, string>();
  bootstrap(input: Omit<JiraBootstrapConnection, "stage">): JiraBootstrapConnection {
    if (!input.id || input.version < 1 || !input.exactBuild || !input.baseUrl)
      throw new Error("JIRA_BOOTSTRAP_INVALID");
    return Object.freeze({ ...input, stage: "BOOTSTRAP" });
  }
  recordDiscovery(
    connection: JiraBootstrapConnection,
    input: Readonly<{ contentHash: string; capabilities: Readonly<Record<string, boolean>> }>,
  ): JiraDiscoveryRecord {
    if (connection.stage !== "BOOTSTRAP" || !input.contentHash.startsWith("sha256:"))
      throw new Error("JIRA_DISCOVERY_INVALID");
    return Object.freeze({
      connectionId: connection.id,
      connectionVersion: connection.version,
      contentHash: input.contentHash,
      capabilities: Object.freeze({ ...input.capabilities }),
    });
  }
  validateConnection(
    connection: JiraBootstrapConnection,
    discovery: JiraDiscoveryRecord,
  ): JiraValidatedConnection {
    if (
      discovery.connectionId !== connection.id ||
      discovery.connectionVersion !== connection.version ||
      !discovery.capabilities.search
    )
      throw new Error("JIRA_CONNECTION_VALIDATION_FAILED");
    return Object.freeze({
      id: connection.id,
      version: connection.version,
      family: connection.family,
      exactBuild: connection.exactBuild,
      baseUrl: connection.baseUrl,
      stage: "VALIDATED",
      discoveryHash: discovery.contentHash,
    });
  }
  publishProfile(
    input: Omit<JiraPublishedProfile, "state"> | JiraPublishedProfile,
  ): JiraPublishedProfile {
    if (
      input.connection.stage !== "VALIDATED" ||
      !input.contentHash.startsWith("sha256:") ||
      !input.mappingHash.startsWith("sha256:")
    )
      throw new Error("JIRA_PROFILE_VALIDATION_REQUIRED");
    const key = `${input.id}:${input.version}`;
    const current = this.#profiles.get(key);
    const candidate = Object.freeze({ ...input, state: "PUBLISHED" as const });
    if (current && JSON.stringify(current) !== JSON.stringify(candidate))
      throw new Error("PUBLISHED_PROFILE_IMMUTABLE");
    this.#profiles.set(key, candidate);
    return candidate;
  }
  async dryRun(
    _profileId: string,
    probe: (method: "GET" | "HEAD") => Promise<unknown>,
  ): Promise<readonly unknown[]> {
    return Object.freeze([await probe("GET"), await probe("HEAD")]);
  }
  markDrift(
    profileId: string,
    reasonCode: string,
  ): Readonly<{ profileId: string; health: "MAPPING_REQUIRED"; reasonCode: string }> {
    this.#drift.set(profileId, reasonCode);
    return Object.freeze({ profileId, health: "MAPPING_REQUIRED", reasonCode });
  }
}
