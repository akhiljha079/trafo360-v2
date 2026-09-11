import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RequestWithUserId } from "../auth/jwt-auth.guard";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import { PermissionsService } from "./permissions.service";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithUserId>();
    if (!req.userId) throw new ForbiddenException("Not authenticated");

    const permissions = await this.permissionsService.resolve(req.userId);
    const missing = required.filter((code) => !permissions.includes(code));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(", ")}`);
    }
    return true;
  }
}
