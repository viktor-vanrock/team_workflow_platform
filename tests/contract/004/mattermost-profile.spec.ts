import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateMattermostProfile } from "../../../packages/connector-mattermost/src/profile/mattermost-profile-validator.ts";
import { validateMattermostPilotMetadataPackage } from "../../../packages/platform-contracts/src/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const metadata = JSON.parse(
  readFileSync(resolve(root, "config/local/mattermost-pilot-metadata.v1.json"), "utf8"),
) as unknown;

describe("Mattermost profile publication", () => {
  it("binds project, bot, channels, presentation key, retention and reconciliation evidence", () => {
    const pilot = validateMattermostPilotMetadataPackage(metadata);
    expect(
      validateMattermostProfile({
        metadata: pilot,
        profile: {
          workspaceId: pilot.workspaceId,
          projectId: pilot.projectId,
          teamId: pilot.teamId,
          botUserId: pilot.botUserId,
          channelIds: pilot.channelIds,
        },
      }),
    ).toMatchObject({ status: "VALID" });
  });

  it("rejects bot/channel/key aliases across projects", () => {
    const pilot = validateMattermostPilotMetadataPackage(metadata);
    expect(() =>
      validateMattermostProfile({
        metadata: pilot,
        profile: {
          workspaceId: pilot.workspaceId,
          projectId: "foreign",
          teamId: pilot.teamId,
          botUserId: pilot.botUserId,
          channelIds: pilot.channelIds,
        },
      }),
    ).toThrow(/SCOPE/u);
  });
});
