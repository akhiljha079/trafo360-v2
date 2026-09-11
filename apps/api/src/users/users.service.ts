import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { SetPermissionOverridesDto } from "./dto/set-permission-overrides.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

export interface ListUsersQuery {
  search?: string;
  departmentId?: string;
  roleId?: string;
  status?: "ACTIVE" | "INACTIVE";
  page?: number;
  pageSize?: number;
}

const userListSelect = {
  id: true,
  username: true,
  employeeId: true,
  name: true,
  email: true,
  mobile: true,
  designation: true,
  source: true,
  status: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  role: { select: { id: true, name: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { username: { contains: query.search, mode: "insensitive" as const } },
              { email: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userListSelect,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userListSelect,
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async create(dto: CreateUserDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });
    if (existing) throw new ConflictException("A user with that username or email already exists");

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        name: dto.name,
        email: dto.email,
        passwordHash,
        source: "LOCAL",
        departmentId: dto.departmentId,
        roleId: dto.roleId,
      },
      select: userListSelect,
    });
    await this.audit.log({
      userId: actorUserId,
      action: "USER_CREATED",
      objectType: "User",
      objectId: user.id,
      newValue: { username: user.username, email: user.email },
      ipAddress: ip,
    });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("User not found");

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        mobile: dto.mobile,
        designation: dto.designation,
        employeeId: dto.employeeId,
        departmentId: dto.departmentId,
        roleId: dto.roleId,
        status: dto.status,
      },
      select: userListSelect,
    });

    await this.audit.log({
      userId: actorUserId,
      action: "USER_UPDATED",
      objectType: "User",
      objectId: id,
      oldValue: { departmentId: before.departmentId, roleId: before.roleId, status: before.status },
      newValue: dto,
      ipAddress: ip,
    });
    return user;
  }

  async getLoginHistory(id: string) {
    return this.prisma.loginHistory.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async setPermissionOverrides(id: string, dto: SetPermissionOverridesDto, actorUserId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.overrides.map((o) => o.permissionCode) } },
    });
    const byCode = new Map(permissions.map((p) => [p.code, p.id]));

    await this.prisma.$transaction([
      this.prisma.userPermissionOverride.deleteMany({ where: { userId: id } }),
      ...dto.overrides
        .filter((o) => byCode.has(o.permissionCode))
        .map((o) =>
          this.prisma.userPermissionOverride.create({
            data: {
              userId: id,
              permissionId: byCode.get(o.permissionCode)!,
              effect: o.effect,
              reason: o.reason,
            },
          }),
        ),
    ]);

    await this.audit.log({
      userId: actorUserId,
      action: "USER_PERMISSION_OVERRIDES_SET",
      objectType: "User",
      objectId: id,
      newValue: dto.overrides,
      ipAddress: ip,
    });

    return this.get(id);
  }
}
