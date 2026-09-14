import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NOTIFICATION_EVENTS } from "@trafo360/shared";
import { AuditService } from "../common/audit.service";
import { PermissionsService } from "../common/permissions.service";
import { NotificationsService } from "../notifications/notifications.service";
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
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
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

    await this.notifyDepartmentsOfNewProject(project);

    return project;
  }

  /** "Email every department's concerned person when a new project is
   * created, so they know to send their documents to the Document
   * Coordinator" - one notification per department that actually has a
   * head set (Administration -> Departments), carrying project/customer
   * details plus the actual document names required from that specific
   * department (from this project's own instantiated checklist, not the
   * raw template - so a project-level override that marked something Not
   * Applicable doesn't get listed as required). No workflow template
   * assigned (or nothing routed to that department) means an empty list,
   * not an error. Best-effort: a notification failure must never fail
   * project creation itself. */
  private async notifyDepartmentsOfNewProject(project: {
    id: string;
    projectNo: string;
    name: string;
    customer: { name: string };
    documentCoordinator: { name: string } | null;
  }): Promise<void> {
    try {
      const departments = await this.prisma.department.findMany({
        where: { active: true, headId: { not: null } },
        include: { head: true },
      });
      if (departments.length === 0) return;

      const requirements = await this.prisma.projectDocumentRequirement.findMany({
        where: { projectStage: { projectId: project.id }, notApplicable: false },
        include: {
          projectStage: { include: { stage: true } },
          stageDocumentRequirement: { include: { documentType: true } },
        },
      });
      const docNamesByDepartmentId = new Map<string, string[]>();
      for (const req of requirements) {
        const deptId = req.projectStage.stage.responsibleDepartmentId;
        if (!deptId) continue;
        const names = docNamesByDepartmentId.get(deptId) ?? [];
        names.push(req.stageDocumentRequirement.documentType.name);
        docNamesByDepartmentId.set(deptId, names);
      }

      for (const dept of departments) {
        if (!dept.head) continue;
        const docNames = docNamesByDepartmentId.get(dept.id) ?? [];
        await this.notifications.notify(NOTIFICATION_EVENTS.PROJECT_CREATED_DEPARTMENT_NOTICE, dept.head.id, {
          projectNo: project.projectNo,
          projectName: project.name,
          customerName: project.customer.name,
          documentCoordinatorName: project.documentCoordinator?.name ?? "the Document Coordinator",
          documentList: docNames.length > 0 ? docNames.join(", ") : "No specific documents assigned to your department yet",
        });
      }
    } catch (err) {
      this.logger.warn(`PROJECT_CREATED_DEPARTMENT_NOTICE failed (project creation itself still succeeded): ${(err as Error).message}`);
    }
  }

  /** Edit/delete are restricted to the System Administrator role
   * specifically, not just whoever holds project.edit/project.delete - the
   * default seed also grants project.edit to Document Coordinator (they
   * need it for day-to-day project setup), but editing core project
   * fields and removing a project outright are deliberately admin-only,
   * by explicit request - not something the permission system's normal
   * role-editable grants should be able to widen. */
  private async assertIsAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (user?.role?.name !== "System Administrator") {
      throw new ForbiddenException("Only a System Administrator can do this");
    }
  }

  async update(id: string, dto: UpdateProjectDto, actorUserId: string, ip?: string) {
    await this.assertIsAdmin(actorUserId);
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

    // A project created (or left) without a template had no way to get one
    // afterward - the edit form is the only place to assign/change it, and
    // assigning one here has to actually generate the checklist too, not
    // just set the FK, or the project would show "has a template" with an
    // empty workflow tab. instantiateForProject() is upsert-based
    // (idempotent), safe to call even if some stages already exist from an
    // earlier template.
    if (dto.workflowTemplateId && dto.workflowTemplateId !== before.workflowTemplateId) {
      await this.workflow.instantiateForProject(id, actorUserId, ip);
    }

    return project;
  }

  /** Postgres itself is the safety net here: Document/PhysicalFile rows
   * reference projectId without ON DELETE CASCADE (deliberately, per
   * schema.prisma), so deleting a project that still has real content
   * fails with a foreign key violation rather than silently cascading
   * through uploaded files and physical file records. Members/stages *do*
   * cascade (pure project-scoped bookkeeping, nothing anyone would miss). */
  async delete(id: string, actorUserId: string, ip?: string): Promise<void> {
    await this.assertIsAdmin(actorUserId);
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException("Project not found");

    try {
      await this.prisma.project.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
        throw new ConflictException(
          "This project still has documents, physical files, or other records tied to it - remove those first.",
        );
      }
      throw err;
    }

    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_DELETED",
      objectType: "Project",
      objectId: id,
      oldValue: { projectNo: project.projectNo, name: project.name },
      ipAddress: ip,
    });
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
