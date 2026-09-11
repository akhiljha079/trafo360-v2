import { applyDecorators, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePermissions } from "./permissions.decorator";

/** Requires a valid session, and (if any codes are given) all listed
 * permissions. Use on every controller/handler that isn't public. */
export const Auth = (...permissionCodes: string[]) =>
  applyDecorators(UseGuards(JwtAuthGuard, PermissionsGuard), RequirePermissions(...permissionCodes));
