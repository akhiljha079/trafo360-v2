import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { SetRolePermissionsDto } from "./dto/set-role-permissions.dto";
import { UpsertRoleDto } from "./dto/upsert-role.dto";

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ category: "asc" }, { code: "asc" }] });
  }

  list() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  async create(dto: UpsertRoleDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException("A role with that name already exists");
    const role = await this.prisma.role.create({
      data: { name: dto.name, description: dto.description, maxConfidentialityLevelId: dto.maxConfidentialityLevelId },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "ROLE_CREATED",
      objectType: "Role",
      objectId: role.id,
      newValue: dto,
      ipAddress: ip,
    });
    return role;
  }

  async update(id: string, dto: UpsertRoleDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.role.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Role not found");
    const role = await this.prisma.role.update({
      where: { id },
      data: { name: dto.name, description: dto.description, maxConfidentialityLevelId: dto.maxConfidentialityLevelId },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "ROLE_UPDATED",
      objectType: "Role",
      objectId: id,
      oldValue: { name: before.name, description: before.description },
      newValue: dto,
      ipAddress: ip,
    });
    return role;
  }

  async setPermissions(id: string, dto: SetRolePermissionsDto, actorUserId: string, ip?: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException("Role not found");
    if (role.isSystem && role.name === "System Administrator" && !dto.permissionCodes.includes("settings.manage")) {
      // Guardrail, not an absolute lock: prevents accidentally locking every
      // admin out of Administration by unchecking the wrong box.
      throw new BadRequestException("System Administrator must always retain settings.manage");
    }

    const permissions = await this.prisma.permission.findMany({ where: { code: { in: dto.permissionCodes } } });

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      ...permissions.map((p) =>
        this.prisma.rolePermission.create({ data: { roleId: id, permissionId: p.id } }),
      ),
    ]);

    await this.audit.log({
      userId: actorUserId,
      action: "ROLE_PERMISSIONS_SET",
      objectType: "Role",
      objectId: id,
      newValue: dto.permissionCodes,
      ipAddress: ip,
    });

    return this.get(id);
  }
}
