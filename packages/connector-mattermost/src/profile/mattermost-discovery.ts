export interface MattermostDiscoveryTransport {
  get(path: string): Promise<unknown>;
}
export interface MattermostDiscoveryResult {
  readonly apiFamily: "v4";
  readonly buildVersion: string;
  readonly serverVersion: string;
  readonly features: Readonly<{
    interactiveDialogs: boolean;
    interactiveMessages: boolean;
    directMessages: boolean;
  }>;
}
export async function discoverMattermost(
  transport: MattermostDiscoveryTransport,
): Promise<MattermostDiscoveryResult> {
  const [system, config] = await Promise.all([
    transport.get("/api/v4/system/ping"),
    transport.get("/api/v4/config/client?format=old"),
  ]);
  const ping = system as Record<string, unknown>;
  const settings = config as Record<string, unknown>;
  if (ping.status !== "OK") throw new Error("MATTERMOST_DISCOVERY_UNHEALTHY");
  return Object.freeze({
    apiFamily: "v4",
    buildVersion: String(ping.build_number ?? "unknown"),
    serverVersion: String(ping.version ?? "unknown"),
    features: Object.freeze({
      interactiveDialogs: settings.EnableCommands !== "false",
      interactiveMessages: settings.EnablePostIconOverride !== "false",
      directMessages: true,
    }),
  });
}
