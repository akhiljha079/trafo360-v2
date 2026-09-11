import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

/** Gate for endpoints the worker process calls on a schedule (not a logged-in
 * user) - checked against INTERNAL_WORKER_TOKEN rather than the JWT session
 * used everywhere else, since the worker has no user to authenticate as.
 * Deliberately narrow: only for the one or two endpoints a background job
 * needs to trigger directly, never a substitute for @Auth(). */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_WORKER_TOKEN;
    if (!expected) {
      throw new ForbiddenException("INTERNAL_WORKER_TOKEN is not configured on the server");
    }
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header("x-internal-token");
    if (provided !== expected) {
      throw new ForbiddenException("Invalid internal token");
    }
    return true;
  }
}
