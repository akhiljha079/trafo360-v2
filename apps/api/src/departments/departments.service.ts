import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertDepartmentDto } from "./dto/upsert-department.dto";

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.department.findMany({
      include: { head: { select: { id: true, name: true } }, _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    });
  }

  async create(dto: UpsertDepartmentDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.department.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException("A department with that code already exists");
    const dept = await this.prisma.department.create({
      data: { code: dto.code, name: dto.name, headId: dto.headId, active: dto.active ?? true },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "DEPARTMENT_CREATED",
      objectType: "Department",
      objectId: dept.id,
      newValue: dto,
      ipAddress: ip,
    });
    return dept;
  }

  async update(id: string, dto: UpsertDepartmentDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Department not found");
    const dept = await this.prisma.department.update({
      where: { id },
      data: { name: dto.name, headId: dto.headId, active: dto.active },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "DEPARTMENT_UPDATED",
      objectType: "Department",
      objectId: id,
      oldValue: { name: before.name, headId: before.headId, active: before.active },
      newValue: dto,
      ipAddress: ip,
    });
    return dept;
  }
}
