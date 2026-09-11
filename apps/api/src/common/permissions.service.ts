import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Resolves a user's effective permissions: role grants, minus explicit
 * REVOKE overrides, plus explicit GRANT overrides. See architecture plan §5.
 * Lives in the global CommonModule (not AuthModule) so PermissionsGuard can
 * depend on it without creating an AuthModule <-> LdapModule import cycle
 * (AuthModule needs LdapService for AD login; LdapModule's controller needs
 * PermissionsGuard). */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissionOverrides: { include: { permission: true } },
      },
    });

    const effective = new Set(user.role?.permissions.map((rp) => rp.permission.code) ?? []);
    for (const override of user.permissionOverrides) {
      if (override.effect === "GRANT") effective.add(override.permission.code);
      if (override.effect === "REVOKE") effective.delete(override.permission.code);
    }
    return [...effective];
  }

  /** Confidentiality ceiling (spec §23), shared by Projects and Documents
   * (extracted here once it was needed in both places). A role with no
   * explicit maxConfidentialityLevel defaults to PUBLIC-only - secure by
   * default, not unrestricted. */
  async getConfidentialityRank(userId: string): Promise<number> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: { include: { maxConfidentialityLevel: true } } },
    });
    return user.role?.maxConfidentialityLevel?.rank ?? 1;
  }
}
