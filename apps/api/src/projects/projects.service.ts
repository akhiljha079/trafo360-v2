import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../common/audit.service";
import { PermissionsService } from "../common/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkflowService } from "../workflow/workflow.service";
import { AddProjectMemberDto } from "./dto/add-member.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";

export interface ListProjectsQuery {
  search?: string;
  customerId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

const projectListInclude = {
  customer: { select: { id: true, code: true, name: true } },
  projectManager: { select: { id: true, name: true } },
  documentCoordinator: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  confidentialityLevel: true,
  workflowTemplate: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Atomic per-year sequence via Postgres's ON CONFLICT, so concurrent
   * project creation can't collide - no read-then-write race. Format is
   * spec §12's example (PRJ-2026-000123); admin-configurable numbering
   * (spec §6/§52) is deferred, see docs/BUILD_PROGRESS.md. */
  private async generateProjectNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const key = `project_number_seq_${year}`;
    const rows = await this.prisma.$queryRaw<{ value: string }[]>`
      INSERT INTO "SystemSetting" (id, key, value, "isSecret", "updatedAt")
      VALUES (gen_random_uuid()::text, ${key}, '1', false, now())
      ON CONFLICT (key) DO UPDATE
        SET value = (CAST("SystemSetting".value AS INTEGER) + 1)::text, "updatedAt" = now()
      RETURNING value;
    `;
    const seq = Number(rows[0].value);
    return `PRJ-${year}-${String(seq).padStart(6, "0")}`;
  }

  async list(query: ListProjectsQuery, userId: string) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const ceiling = await this.permissions.getConfidentialityRank(userId);

    const where = {
      confidentialityLevel: { rank: { lte: ceiling } },
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { projectNo: { contains: query.search, mode: "insensitive" as const } },
              { name: { contains: query.search, mode: "insensitive" as const } },
              { customerPo: { contains: query.search, mode: "insensitive" as const } },
              { transformerSerial: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: projectListInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        ...projectListInclude,
        members: { include: { user: { select: { id: true, name: true, username: true } } } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const ceiling = await this.permissions.getConfidentialityRank(userId);
    if (project.confidentialityLevel.rank > ceiling) {
      throw new ForbiddenException("This project's confidentiality level exceeds your access");
    }
    return project;
  }

  async create(dto: CreateProjectDto, actorUserId: string, ip?: string) {
    const projectNo = await this.generateProjectNumber();
    const project = await this.prisma.project.create({
      data: { ...dto, projectNo, status: "DRAFT" },
      include: projectListInclude,
    });
    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_CREATED",
      objectType: "Project",
      objectId: project.id,
      newValue: { projectNo, ...dto },
      ipAddress: ip,
    });

    if (dto.workflowTemplateId) {
      await this.workflow.instantiateForProject(project.id, actorUserId, ip);
    }
    return project;
  }

  async update(id: string, dto: UpdateProjectDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Project not found");
    const project = await this.prisma.project.update({ where: { id }, data: dto, include: projectListInclude });
    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_UPDATED",
      objectType: "Project",
      objectId: id,
      oldValue: before,
      newValue: dto,
      ipAddress: ip,
    });
    return project;
  }

  async addMember(projectId: string, dto: AddProjectMemberDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: dto.userId } },
    });
    if (existing) throw new ConflictException("User is already a member of this project");
    const member = await this.prisma.projectMember.create({
      data: { projectId, userId: dto.userId, roleInProject: dto.roleInProject },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_MEMBER_ADDED",
      objectType: "Project",
      objectId: projectId,
      newValue: dto,
      ipAddress: ip,
    });
    return member;
  }

  async removeMember(projectId: string, memberUserId: string, actorUserId: string, ip?: string) {
    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberUserId } },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_MEMBER_REMOVED",
      objectType: "Project",
      objectId: projectId,
      oldValue: { userId: memberUserId },
      ipAddress: ip,
    });
    return { ok: true };
  }
}
