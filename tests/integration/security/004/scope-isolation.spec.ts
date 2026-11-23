import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateMattermostProfile } from "../../../../packages/connector-mattermost/src/profile/mattermost-profile-validator.ts";

const metadata = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../config/local/mattermost-pilot-metadata.v1.json"),
    "utf8",
  ),
);
describe("Mattermost scope isolation", () =>
  it("rejects cross-project bot/channel aliases", () =>
    expect(() =>
      validateMattermostProfile({
        metadata,
        profile: {
          workspaceId: metadata.workspaceId,
          projectId: metadata.projectId,
          teamId: metadata.teamId,
          botUserId: metadata.botUserId,
          channelIds: metadata.channelIds,
        },
        activeAliases: [
          {
            workspaceId: metadata.workspaceId,
            projectId: "foreign",
            teamId: metadata.teamId,
            botUserId: metadata.botUserId,
            channelIds: metadata.channelIds,
          },
        ],
      }),
    ).toThrow(/ALIAS/u)));
