import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard, RequestWithUserId } from "./jwt-auth.guard";

const ACCESS_COOKIE = "trafo360_access";
const REFRESH_COOKIE = "trafo360_refresh";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const secure = this.config.get<string>("NODE_ENV") === "production";
    res.cookie(ACCESS_COOKIE, accessToken, { httpOnly: true, sameSite: "strict", secure, maxAge: 15 * 60 * 1000 });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  // Tighter than the global default (see AppModule) - login is the actual
  // brute-force target. 10 attempts/minute per IP is generous for a real
  // user who fat-fingered a password, punishing for a credential-stuffing
  // script.
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateCredentials(
      dto.username,
      dto.password,
      req.ip,
      req.headers["user-agent"],
    );
    const { accessToken, refreshToken } = await this.auth.issueTokens(user.id);
    this.setAuthCookies(res, accessToken, refreshToken);
    return this.auth.getAuthenticatedUser(user.id);
  }

  /** Silently mints a fresh access token from a still-valid refresh token
   * (rotated on every use). The frontend calls this once on a 401 and
   * retries the original request - see apps/web/src/api/client.ts. Without
   * this, every session would hard-expire after the 15-minute access token
   * lifetime, which is a poor fit for an internal app people keep open all
   * day. */
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException("No refresh token");
    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>("JWT_REFRESH_SECRET"),
      });
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException("Refresh token expired");
    }
    const { accessToken, refreshToken } = await this.auth.issueTokens(userId);
    this.setAuthCookies(res, accessToken, refreshToken);
    return this.auth.getAuthenticatedUser(userId);
  }

  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_COOKIE);
    res.clearCookie(REFRESH_COOKIE);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: RequestWithUserId) {
    return this.auth.getAuthenticatedUser(req.userId!);
  }

  @Post("change-password")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: RequestWithUserId) {
    await this.auth.changePassword(req.userId!, dto.currentPassword, dto.newPassword, req.ip);
    return { ok: true };
  }
}
