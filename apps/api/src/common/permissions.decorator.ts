import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "requiredPermissions";

/** Route/controller-level permission requirement. Enforced by PermissionsGuard,
 * which must run after JwtAuthGuard (needs req.userId). See architecture plan
 * §5: this is enforcement layer 1 of 3 - resource-level and confidentiality
 * checks still happen in the relevant service methods. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
