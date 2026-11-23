import {
  Body,
  Controller,
  type DynamicModule,
  Get,
  HttpCode,
  Inject,
  Module,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";

import {
  type CorporateSessionRequest,
  CorporateSessionService,
} from "./corporate-session.service.ts";

export const CORPORATE_SESSION_SERVICE = Symbol("CORPORATE_SESSION_SERVICE");
interface SessionResponse {
  setHeader(name: string, value: string | readonly string[]): void;
  redirect(status: number, url: string): void;
}

@Controller("api/v1/auth")
export class CorporateSessionController {
  constructor(
    @Inject(CORPORATE_SESSION_SERVICE) private readonly sessions: CorporateSessionService,
  ) {}
  private headers(response: SessionResponse): void {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
  }
  @Post("login")
  @HttpCode(200)
  async login(
    @Req() request: CorporateSessionRequest,
    @Body() body: Readonly<{ returnPath: string; stepUp?: boolean }>,
    @Res({ passthrough: true }) response: SessionResponse,
  ) {
    this.headers(response);
    try {
      if (
        !body ||
        Object.keys(body).some((key) => !["returnPath", "stepUp"].includes(key)) ||
        typeof body.returnPath !== "string" ||
        (body.stepUp !== undefined && typeof body.stepUp !== "boolean")
      )
        throw new Error();
      const result = await this.sessions.begin(request, body);
      response.setHeader("Set-Cookie", result.cookie);
      return { authorizationUrl: result.authorizationUrl };
    } catch {
      throw new UnauthorizedException("CORPORATE_SESSION_DENIED");
    }
  }
  @Get("callback")
  async callback(
    @Req() request: CorporateSessionRequest,
    @Query() query: Readonly<Record<string, unknown>>,
    @Res() response: SessionResponse,
  ): Promise<void> {
    this.headers(response);
    try {
      const result = await this.sessions.callback(request, query);
      response.setHeader("Set-Cookie", [result.cookie, result.clearLoginCookie]);
      response.redirect(303, result.returnPath);
    } catch {
      throw new UnauthorizedException("CORPORATE_SESSION_DENIED");
    }
  }
  @Get("session")
  async session(
    @Req() request: CorporateSessionRequest,
    @Res({ passthrough: true }) response: SessionResponse,
  ) {
    this.headers(response);
    try {
      return await this.sessions.session(request);
    } catch {
      throw new UnauthorizedException("CORPORATE_SESSION_DENIED");
    }
  }
  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() request: CorporateSessionRequest,
    @Res({ passthrough: true }) response: SessionResponse,
  ): Promise<void> {
    this.headers(response);
    try {
      response.setHeader("Set-Cookie", await this.sessions.logout(request));
    } catch {
      throw new UnauthorizedException("CORPORATE_SESSION_DENIED");
    }
  }
}

@Module({})
export class CorporateAuthenticationModule {
  static configured(service: CorporateSessionService): DynamicModule {
    return {
      module: CorporateAuthenticationModule,
      controllers: [CorporateSessionController],
      providers: [{ provide: CORPORATE_SESSION_SERVICE, useValue: service }],
      exports: [CORPORATE_SESSION_SERVICE],
    };
  }
}
