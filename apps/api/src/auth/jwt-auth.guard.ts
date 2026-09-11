import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

export interface RequestWithUserId extends Request {
  userId?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUserId>();
    const token = req.cookies?.["trafo360_access"];
    if (!token) throw new UnauthorizedException("Not authenticated");
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>("JWT_ACCESS_SECRET"),
      });
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException("Session expired");
    }
  }
}
