import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { AuditService } from "../common/audit.service";
import { PermissionsService } from "../common/permissions.service";
import { LdapService } from "../ldap/ldap.service";
import { PrismaService } from "../prisma/prisma.service";

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly permissionsService: PermissionsService,
    private readonly ldap: LdapService,
    private readonly audit: AuditService,
  ) {}

  async resolvePermissions(userId: string): Promise<string[]> {
    return this.permissionsService.resolve(userId);
  }

  /** Validates credentials for either a LOCAL (bootstrap admin, bcrypt) or
   * AD (bind-as-user via LdapService, password never persisted) user, and
   * records login history either way. See architecture plan §5/§8. */
  async validateCredentials(username: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });

    const fail = async (reason: string) => {
      if (user) {
        await this.prisma.loginHistory.create({
          data: { userId: user.id, success: false, ipAddress, userAgent, failureReason: reason },
        });
      }
      throw new UnauthorizedException("Invalid username or password");
    };

    if (!user) return fail("no_such_user");
    if (user.status !== "ACTIVE") return fail("inactive");

    if (user.source === "LOCAL") {
      if (!user.passwordHash) return fail("no_local_password_set");
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return fail("bad_password");
    } else {
      try {
        await this.ldap.authenticate(username, password);
      } catch {
        return fail("ad_bind_failed");
      }
    }

    await this.prisma.loginHistory.create({ data: { userId: user.id, success: true, ipAddress, userAgent } });
    await this.prisma.auditLog.create({
      data: { userId: user.id, action: "USER_LOGGED_IN", objectType: "User", objectId: user.id, ipAddress },
    });

    return user;
  }

  async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: this.config.get<string>("JWT_ACCESS_SECRET"), expiresIn: "15m" },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: this.config.get<string>("JWT_REFRESH_SECRET"), expiresIn: "7d" },
    );
    return { accessToken, refreshToken };
  }

  /** Self-service password change - LOCAL users only. AD-sourced users never
   * get a passwordHash in the first place (spec §7's "never duplicate AD
   * passwords") - their password is managed by the directory, not this app,
   * so there's nothing here for them to change. */
  async changePassword(userId: string, currentPassword: string, newPassword: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.source !== "LOCAL" || !user.passwordHash) {
      throw new BadRequestException(
        "Your password is managed by your organization's directory (AD) - change it there instead.",
      );
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Current password is incorrect");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    await this.audit.log({
      userId,
      action: "USER_CHANGED_OWN_PASSWORD",
      objectType: "User",
      objectId: userId,
      ipAddress: ip,
    });
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
    const permissions = await this.permissionsService.resolve(userId);
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role?.name ?? null,
      permissions,
    };
  }
}
