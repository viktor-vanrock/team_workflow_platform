import type { DataSource } from "typeorm";

export type MattermostFault =
  | "NORMAL"
  | "TIMEOUT_BEFORE_EFFECT"
  | "TIMEOUT_AFTER_EFFECT"
  | "AUTHENTICATION_401"
  | "PERMISSION_403"
  | "RATE_LIMIT_429"
  | "SERVER_500"
  | "NETWORK_LOSS"
  | "LOOKUP_ZERO"
  | "LOOKUP_MULTIPLE"
  | "LOOKUP_UNSUPPORTED";

export interface MattermostTeam {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
}
export interface MattermostChannel {
  readonly id: string;
  readonly teamId: string;
  readonly name: string;
  readonly displayName: string;
  readonly purpose: string;
}
export interface MattermostUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly isBot: boolean;
}
export interface MattermostMembership {
  readonly teamId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly roles: readonly string[];
}
export interface MattermostPost {
  readonly id: string;
  readonly channelId: string;
  readonly userId: string;
  readonly message: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly effectKey: string;
  readonly createdAt: string;
}
export interface MattermostState {
  readonly teams: readonly MattermostTeam[];
  readonly channels: readonly MattermostChannel[];
  readonly users: readonly MattermostUser[];
  readonly memberships: readonly MattermostMembership[];
  readonly posts: readonly MattermostPost[];
}
export interface CreateMattermostPost {
  readonly effectKey: string;
  readonly channelId: string;
  readonly message: string;
  readonly userId?: string;
  readonly props?: Readonly<Record<string, unknown>>;
}

const seededState: MattermostState = Object.freeze({
  teams: Object.freeze([
    Object.freeze({
      id: "mm-team-project-alpha",
      name: "project-alpha",
      displayName: "Project Alpha",
    }),
    Object.freeze({
      id: "mm-team-project-beta",
      name: "project-beta",
      displayName: "Project Beta",
    }),
  ]),
  channels: Object.freeze([
    Object.freeze({
      id: "mm-channel-project-alpha",
      teamId: "mm-team-project-alpha",
      name: "qa-updates",
      displayName: "QA Updates",
      purpose: "QA_UPDATES",
    }),
    Object.freeze({
      id: "mm-channel-project-beta",
      teamId: "mm-team-project-beta",
      name: "qa-updates",
      displayName: "QA Updates",
      purpose: "QA_UPDATES",
    }),
  ]),
  users: Object.freeze([
    Object.freeze({ id: "mm-user-alex", username: "alex", displayName: "Alex", isBot: false }),
    Object.freeze({ id: "mm-user-hermes", username: "hermes", displayName: "Hermes", isBot: true }),
  ]),
  memberships: Object.freeze([
    Object.freeze({
      teamId: "mm-team-project-alpha",
      channelId: "mm-channel-project-alpha",
      userId: "mm-user-alex",
      roles: Object.freeze(["channel_user"]),
    }),
    Object.freeze({
      teamId: "mm-team-project-alpha",
      channelId: "mm-channel-project-alpha",
      userId: "mm-user-hermes",
      roles: Object.freeze(["channel_user"]),
    }),
    Object.freeze({
      teamId: "mm-team-project-beta",
      channelId: "mm-channel-project-beta",
      userId: "mm-user-hermes",
      roles: Object.freeze(["channel_user"]),
    }),
  ]),
  posts: Object.freeze([]),
});

interface InMemoryBacking {
  state: MattermostState;
  fault: MattermostFault;
  postSequence: number;
  readonly calls: MattermostEffectCall[];
}
export interface MattermostEffectCall {
  readonly effectKey: string;
  readonly operation: "CREATE_POST";
  readonly outcome: string;
  readonly externalPostId?: string;
}

export class InMemoryMattermostRepository {
  private constructor(private readonly backing: InMemoryBacking) {}

  static seeded(): InMemoryMattermostRepository {
    return new InMemoryMattermostRepository({
      state: structuredClone(seededState),
      fault: "NORMAL",
      postSequence: 0,
      calls: [],
    });
  }

  snapshot(): MattermostState {
    return structuredClone(this.backing.state);
  }
  restart(): InMemoryMattermostRepository {
    return new InMemoryMattermostRepository(this.backing);
  }
  setFault(fault: MattermostFault): void {
    this.backing.fault = fault;
  }
  lookupEffect(effectKey: string): readonly MattermostPost[] {
    const matches = this.backing.state.posts.filter((post) => post.effectKey === effectKey);
    if (this.backing.fault === "LOOKUP_ZERO") return [];
    if (this.backing.fault === "LOOKUP_UNSUPPORTED")
      throw new Error("MATTERMOST_MOCK_LOOKUP_UNSUPPORTED");
    if (this.backing.fault === "LOOKUP_MULTIPLE" && matches.length === 1)
      return Object.freeze([matches[0]!, { ...matches[0]!, id: `${matches[0]!.id}-duplicate` }]);
    return structuredClone(matches);
  }

  createPost(input: CreateMattermostPost): MattermostPost {
    if (this.backing.fault === "TIMEOUT_BEFORE_EFFECT")
      throw new Error("MATTERMOST_MOCK_TIMEOUT_BEFORE_EFFECT");
    if (this.backing.fault === "NETWORK_LOSS") throw new Error("MATTERMOST_MOCK_NETWORK_LOSS");
    if (this.lookupEffect(input.effectKey).length > 0)
      throw new Error("MATTERMOST_MOCK_DUPLICATE_EFFECT");
    if (!this.backing.state.channels.some((channel) => channel.id === input.channelId))
      throw new Error("MATTERMOST_MOCK_CHANNEL_NOT_FOUND");
    const post = Object.freeze({
      id: `mm-post-${++this.backing.postSequence}`,
      channelId: input.channelId,
      userId: input.userId ?? "mm-user-hermes",
      message: input.message,
      props: Object.freeze(structuredClone(input.props ?? {})),
      effectKey: input.effectKey,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.backing.postSequence)).toISOString(),
    });
    this.backing.state = Object.freeze({
      ...this.backing.state,
      posts: Object.freeze([...this.backing.state.posts, post]),
    });
    this.backing.calls.push(
      Object.freeze({
        effectKey: input.effectKey,
        operation: "CREATE_POST",
        outcome: "APPLIED",
        externalPostId: post.id,
      }),
    );
    if (this.backing.fault === "TIMEOUT_AFTER_EFFECT")
      throw new Error("MATTERMOST_MOCK_TIMEOUT_AFTER_EFFECT");
    return structuredClone(post);
  }
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Readonly<Record<string, unknown>> =>
          !!row && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

export class TypeOrmMattermostRepository {
  constructor(private readonly source: DataSource) {}

  async setFault(fault: MattermostFault, remaining = 1): Promise<void> {
    await this.source.query(
      "UPDATE mattermost_mock_faults SET fault=$1,remaining=$2 WHERE singleton=1",
      [fault, fault === "NORMAL" ? 0 : remaining],
    );
  }

  async lookupEffect(effectKey: string): Promise<readonly MattermostPost[]> {
    const fault = await this.consumeFault(false);
    if (fault === "LOOKUP_ZERO") return [];
    if (fault === "LOOKUP_UNSUPPORTED") throw new Error("MATTERMOST_MOCK_LOOKUP_UNSUPPORTED");
    const rows = records(
      await this.source.query(
        "SELECT id,channel_id,user_id,message,props,effect_key,created_at FROM mock_mattermost_posts WHERE effect_key=$1 ORDER BY id",
        [effectKey],
      ),
    );
    const posts = rows.map(toPost);
    return fault === "LOOKUP_MULTIPLE" && posts.length === 1
      ? Object.freeze([posts[0]!, { ...posts[0]!, id: `${posts[0]!.id}-duplicate` }])
      : Object.freeze(posts);
  }

  async createPost(input: CreateMattermostPost): Promise<MattermostPost> {
    const fault = await this.consumeFault(true);
    if (fault === "TIMEOUT_BEFORE_EFFECT") throw new Error("MATTERMOST_MOCK_TIMEOUT_BEFORE_EFFECT");
    if (fault === "NETWORK_LOSS") throw new Error("MATTERMOST_MOCK_NETWORK_LOSS");
    const id = `mm-post-${crypto.randomUUID()}`;
    try {
      const rows = records(
        await this.source.query(
          "INSERT INTO mock_mattermost_posts(id,channel_id,user_id,message,props,effect_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,channel_id,user_id,message,props,effect_key,created_at",
          [
            id,
            input.channelId,
            input.userId ?? "mm-user-hermes",
            input.message,
            JSON.stringify(input.props ?? {}),
            input.effectKey,
          ],
        ),
      );
      const post = toPost(rows[0]!);
      await this.record(input.effectKey, "APPLIED", input, post.id);
      if (fault === "TIMEOUT_AFTER_EFFECT") throw new Error("MATTERMOST_MOCK_TIMEOUT_AFTER_EFFECT");
      return post;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        await this.record(input.effectKey, "DUPLICATE", input);
        throw new Error("MATTERMOST_MOCK_DUPLICATE_EFFECT");
      }
      throw error;
    }
  }

  async snapshot(): Promise<MattermostState> {
    const results: readonly unknown[] = await Promise.all([
      this.source.query(
        "SELECT id,name,display_name FROM mattermost_mock_teams ORDER BY id",
      ) as Promise<unknown>,
      this.source.query(
        "SELECT id,team_id,name,display_name,purpose FROM mattermost_mock_channels ORDER BY id",
      ) as Promise<unknown>,
      this.source.query(
        "SELECT id,username,display_name,is_bot FROM mattermost_mock_users ORDER BY id",
      ) as Promise<unknown>,
      this.source.query(
        "SELECT team_id,channel_id,user_id,roles FROM mattermost_mock_memberships ORDER BY team_id,channel_id,user_id",
      ) as Promise<unknown>,
      this.source.query(
        "SELECT id,channel_id,user_id,message,props,effect_key,created_at FROM mock_mattermost_posts ORDER BY created_at,id",
      ) as Promise<unknown>,
    ]);
    return Object.freeze({
      teams: records(results[0]).map((row) =>
        Object.freeze({
          id: String(row.id),
          name: String(row.name),
          displayName: String(row.display_name),
        }),
      ),
      channels: records(results[1]).map((row) =>
        Object.freeze({
          id: String(row.id),
          teamId: String(row.team_id),
          name: String(row.name),
          displayName: String(row.display_name),
          purpose: String(row.purpose),
        }),
      ),
      users: records(results[2]).map((row) =>
        Object.freeze({
          id: String(row.id),
          username: String(row.username),
          displayName: String(row.display_name),
          isBot: Boolean(row.is_bot),
        }),
      ),
      memberships: records(results[3]).map((row) =>
        Object.freeze({
          teamId: String(row.team_id),
          channelId: String(row.channel_id),
          userId: String(row.user_id),
          roles: Object.freeze((row.roles as string[]) ?? []),
        }),
      ),
      posts: records(results[4]).map(toPost),
    });
  }

  async recordCallback(input: {
    readonly callbackKind: string;
    readonly connectionId: string;
    readonly externalUserId: string;
    readonly payload: unknown;
  }): Promise<void> {
    await this.source.query(
      "INSERT INTO mattermost_mock_callbacks(callback_kind,connection_id,external_user_id,payload) VALUES($1,$2,$3,$4)",
      [input.callbackKind, input.connectionId, input.externalUserId, JSON.stringify(input.payload)],
    );
  }

  private async consumeFault(forWrite: boolean): Promise<MattermostFault> {
    const rows = records(
      await this.source.query(
        "SELECT fault,remaining FROM mattermost_mock_faults WHERE singleton=1 FOR UPDATE",
      ),
    );
    const row = rows[0];
    const fault = (row?.fault ?? "NORMAL") as MattermostFault;
    const remaining = Number(row?.remaining ?? 0);
    if (remaining > 0 && (forWrite || fault.startsWith("LOOKUP_"))) {
      await this.source.query(
        "UPDATE mattermost_mock_faults SET remaining=$1,fault=CASE WHEN $1=0 THEN 'NORMAL' ELSE fault END WHERE singleton=1",
        [remaining - 1],
      );
    }
    return remaining > 0 ? fault : "NORMAL";
  }

  private async record(
    effectKey: string,
    outcome: string,
    requestBody: unknown,
    externalPostId?: string,
  ): Promise<void> {
    await this.source.query(
      "INSERT INTO mattermost_mock_effect_calls(effect_key,operation,request_body,outcome,external_post_id) VALUES($1,'CREATE_POST',$2,$3,$4)",
      [effectKey, JSON.stringify(requestBody), outcome, externalPostId ?? null],
    );
  }
}

function toPost(row: Readonly<Record<string, unknown>>): MattermostPost {
  return Object.freeze({
    id: String(row.id),
    channelId: String(row.channel_id),
    userId: String(row.user_id),
    message: String(row.message),
    props: Object.freeze((row.props as Readonly<Record<string, unknown>>) ?? {}),
    effectKey: String(row.effect_key),
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}

export async function seedMattermostRepository(source: DataSource): Promise<void> {
  await source.transaction(async (manager) => {
    for (const team of seededState.teams)
      await manager.query(
        "INSERT INTO mattermost_mock_teams(id,name,display_name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
        [team.id, team.name, team.displayName],
      );
    for (const channel of seededState.channels)
      await manager.query(
        "INSERT INTO mattermost_mock_channels(id,team_id,name,display_name,purpose) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
        [channel.id, channel.teamId, channel.name, channel.displayName, channel.purpose],
      );
    for (const user of seededState.users)
      await manager.query(
        "INSERT INTO mattermost_mock_users(id,username,display_name,is_bot) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
        [user.id, user.username, user.displayName, user.isBot],
      );
    for (const membership of seededState.memberships)
      await manager.query(
        "INSERT INTO mattermost_mock_memberships(team_id,channel_id,user_id,roles) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [membership.teamId, membership.channelId, membership.userId, [...membership.roles]],
      );
  });
}
