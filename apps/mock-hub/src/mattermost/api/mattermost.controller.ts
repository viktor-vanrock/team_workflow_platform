import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  RequestTimeoutException,
  UnauthorizedException,
} from "@nestjs/common";

import {
  type CreateMattermostPost,
  TypeOrmMattermostRepository,
} from "../state/mattermost.repository.ts";

function requiredString(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 16_384 ||
    value.includes("\0")
  ) {
    throw new BadRequestException({ code });
  }
  return value;
}

function mapFault(error: unknown): never {
  const message = error instanceof Error ? error.message : "MATTERMOST_MOCK_ERROR";
  if (message.includes("TIMEOUT")) throw new RequestTimeoutException({ code: message });
  if (message.includes("AUTHENTICATION_401")) throw new UnauthorizedException({ code: message });
  if (message.includes("PERMISSION_403")) throw new ForbiddenException({ code: message });
  if (message.includes("RATE_LIMIT_429"))
    throw new HttpException({ code: message }, HttpStatus.TOO_MANY_REQUESTS);
  if (message.includes("SERVER_500")) throw new InternalServerErrorException({ code: message });
  if (message.includes("NETWORK_LOSS") || message.includes("LOOKUP_UNSUPPORTED"))
    throw new HttpException({ code: message }, HttpStatus.SERVICE_UNAVAILABLE);
  if (message.includes("DUPLICATE"))
    throw new HttpException({ code: message }, HttpStatus.CONFLICT);
  throw error;
}

@Controller("api/v4")
export class MattermostController {
  constructor(
    @Inject(TypeOrmMattermostRepository) private readonly repository: TypeOrmMattermostRepository,
  ) {}

  @Get("system/ping")
  ping() {
    return Object.freeze({ status: "OK", version: "10.5.0", build_number: "local-mattermost-v1" });
  }

  @Get("config/client")
  clientConfig() {
    return Object.freeze({ EnableCommands: "true", EnablePostIconOverride: "true" });
  }

  @Get("teams")
  async teams() {
    return (await this.repository.snapshot()).teams;
  }

  @Get("teams/:teamId/channels")
  async channels(@Param("teamId") teamId: string) {
    return (await this.repository.snapshot()).channels.filter(
      (channel) => channel.teamId === teamId,
    );
  }

  @Get("channels/:channelId/members/:userId")
  async membership(@Param("channelId") channelId: string, @Param("userId") userId: string) {
    const value = (await this.repository.snapshot()).memberships.find(
      (candidate) => candidate.channelId === channelId && candidate.userId === userId,
    );
    if (!value)
      throw new HttpException(
        { code: "MATTERMOST_MOCK_MEMBERSHIP_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    return value;
  }

  @Post("posts")
  async createPost(@Body() body: Record<string, unknown>) {
    const props =
      body.props && typeof body.props === "object" && !Array.isArray(body.props)
        ? (body.props as Readonly<Record<string, unknown>>)
        : {};
    const effectKey = requiredString(
      props.effectKey ?? body.effect_key,
      "MATTERMOST_MOCK_EFFECT_KEY_REQUIRED",
    );
    const input: CreateMattermostPost = {
      effectKey,
      channelId: requiredString(body.channel_id, "MATTERMOST_MOCK_CHANNEL_REQUIRED"),
      message: requiredString(body.message, "MATTERMOST_MOCK_MESSAGE_REQUIRED"),
      props,
    };
    try {
      return await this.repository.createPost(input);
    } catch (error) {
      mapFault(error);
    }
  }

  @Get("posts")
  async lookup(@Query("effect_key") effectKey: string | undefined) {
    const posts = await this.repository.lookupEffect(
      requiredString(effectKey, "MATTERMOST_MOCK_EFFECT_KEY_REQUIRED"),
    );
    return Object.freeze({
      order: Object.freeze(posts.map((post) => post.id)),
      posts: Object.freeze(Object.fromEntries(posts.map((post) => [post.id, post]))),
    });
  }
}
