import { describe, expect, it } from "vitest";

import { InMemoryMattermostRepository } from "../../../apps/mock-hub/src/mattermost/state/mattermost.repository.ts";

describe("Mock Hub Mattermost contract", () =>
  it("models team/channel/user/membership/post state", () => {
    const repository = InMemoryMattermostRepository.seeded();
    expect(repository.snapshot()).toMatchObject({
      teams: expect.any(Array),
      channels: expect.any(Array),
      users: expect.any(Array),
      memberships: expect.any(Array),
      posts: [],
    });
  }));
