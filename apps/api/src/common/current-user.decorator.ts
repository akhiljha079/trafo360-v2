import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestWithUserId } from "../auth/jwt-auth.guard";

/** Injects the authenticated user's id (from JwtAuthGuard). Also exposes the
 * client IP, which every audit-logging mutation should record. */
export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<RequestWithUserId>();
  return req.userId!;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest<RequestWithUserId>();
  return req.ip;
});
