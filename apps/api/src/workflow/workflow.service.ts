import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CloneWorkflowTemplateDto,
  OverrideProjectRequirementDto,
  ReorderDto,
  UpsertParentStageDto,
  UpsertRequirementDto,
  UpsertStageDto,
  UpsertWorkflowTemplateDto,
} from "./dto/workflow.dto";
import { computeStageStatus, RequirementDocStatus } from "./stage-status";

const templateTreeInclude = {
  parentStages: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      stages: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          responsibleDepartment: { select: { id: true, name: true } },
          responsibleRole: { select: { id: true, name: true } },
          documentRequirements: { include: { documentType: true } },
        },
      },
    },
  },
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Templates ---------------------------------------------------------

  listTemplates() {
    return this.prisma.workflowTemplate.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { parentStages: true, projects: true } } },
    });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: templateTreeInclude,
    });
    if (!template) throw new NotFoundException("Workflow template not found");
    return template;
  }

  async createTemplate(dto: UpsertWorkflowTemplateDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.workflowTemplate.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException("A workflow template with that name already exists");
    const template = await this.prisma.workflowTemplate.create({ data: { ...dto, active: false } });
    await this.audit.log({
      userId: actorUserId,
      action: "WORKFLOW_TEMPLATE_CREATED",
      objectType: "WorkflowTemplate",
      objectId: template.id,
      newValue: dto,
      ipAddress: ip,
    });
    return template;
  }

  async updateTemplate(id: string, dto: UpsertWorkflowTemplateDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.workflowTemplate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Workflow template not found");
    const template = await this.prisma.workflowTemplate.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: actorUserId,
      action: "WORKFLOW_TEMPLATE_UPDATED",
      objectType: "WorkflowTemplate",
      objectId: id,
      oldValue: { name: before.name, description: before.description },
      newValue: dto,
      ipAddress: ip,
    });
    return template;
  }

  async setActive(id: string, active: boolean, actorUserId: string, ip?: string) {
    const template = await this.prisma.workflowTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException("Workflow template not found");
    const updated = await this.prisma.workflowTemplate.update({ where: { id }, data: { active } });
    await this.audit.log({
      userId: actorUserId,
      action: active ? "WORKFLOW_TEMPLATE_ACTIVATED" : "WORKFLOW_TEMPLATE_DEACTIVATED",
      objectType: "WorkflowTemplate",
      objectId: id,
      ipAddress: ip,
    });
    return updated;
  }

  async clone(id: string, dto: CloneWorkflowTemplateDto, actorUserId: string, ip?: string) {
    const source = await this.getTemplate(id);
    const existing = await this.prisma.workflowTemplate.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException("A workflow template with that name already exists");

    const clone = await this.prisma.workflowTemplate.create({
      data: { name: dto.name, description: source.description, active: false, clonedFromId: source.id },
    });

    for (const parent of source.parentStages) {
      const newParent = await this.prisma.parentStage.create({
        data: { workflowTemplateId: clone.id, code: parent.code, name: parent.name, sortOrder: parent.sortOrder },
      });
      for (const stage of parent.stages) {
        const newStage = await this.prisma.stage.create({
          data: {
            parentStageId: newParent.id,
            code: stage.code,
            name: stage.name,
            description: stage.description,
            sortOrder: stage.sortOrder,
            responsibleDepartmentId: stage.responsibleDepartmentId,
            responsibleRoleId: stage.responsibleRoleId,
            slaHours: stage.slaHours,
          },
        });
        for (const req of stage.documentRequirements) {
          await this.prisma.stageDocumentRequirement.create({
            data: {
              stageId: newStage.id,
              documentTypeId: req.documentTypeId,
              mandatory: req.mandatory,
              approvalRequired: req.approvalRequired,
              slaHours: req.slaHours,
            },
          });
        }
      }
    }

    await this.audit.log({
      userId: actorUserId,
      action: "WORKFLOW_TEMPLATE_CLONED",
      objectType: "WorkflowTemplate",
      objectId: clone.id,
      oldValue: { clonedFromId: source.id },
      newValue: dto,
      ipAddress: ip,
    });
    return this.getTemplate(clone.id);
  }

  // ---- Parent stages -------------------------------------------------------

  async createParentStage(templateId: string, dto: UpsertParentStageDto, actorUserId: string, ip?: string) {
    const maxSort = await this.prisma.parentStage.aggregate({
      where: { workflowTemplateId: templateId },
      _max: { sortOrder: true },
    });
    const parentStage = await this.prisma.parentStage.create({
      data: { workflowTemplateId: templateId, ...dto, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "PARENT_STAGE_CREATED",
      objectType: "ParentStage",
      objectId: parentStage.id,
      newValue: dto,
      ipAddress: ip,
    });
    return parentStage;
  }

  async updateParentStage(id: string, dto: UpsertParentStageDto, actorUserId: string, ip?: string) {
    const parentStage = await this.prisma.parentStage.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: actorUserId,
      action: "PARENT_STAGE_UPDATED",
      objectType: "ParentStage",
      objectId: id,
      newValue: dto,
      ipAddress: ip,
    });
    return parentStage;
  }

  /** Same FK-safety-net as deleteRequirement below: ProjectStage.stageId has
   * no ON DELETE CASCADE, so this fails once any project has instantiated
   * this template - cascading through Stage (which does cascade from
   * ParentStage) hits that same wall on the first stage that's in use. */
  async deleteParentStage(id: string, actorUserId: string, ip?: string) {
    try {
      await this.prisma.parentStage.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
        throw new ConflictException(
          "This parent stage (or a stage within it) is already in use by one or more projects and can't be removed. Deactivate this template and create a new version for future projects instead.",
        );
      }
      throw err;
    }
    await this.audit.log({
      userId: actorUserId,
      action: "PARENT_STAGE_DELETED",
      objectType: "ParentStage",
      objectId: id,
      ipAddress: ip,
    });
    return { ok: true };
  }

  async reorderParentStages(templateId: string, dto: ReorderDto, actorUserId: string, ip?: string) {
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) =>
        this.prisma.parentStage.update({ where: { id }, data: { sortOrder: index + 1 } }),
      ),
    );
    await this.audit.log({
      userId: actorUserId,
      action: "PARENT_STAGES_REORDERED",
      objectType: "WorkflowTemplate",
      objectId: templateId,
      newValue: dto.orderedIds,
      ipAddress: ip,
    });
    return { ok: true };
  }

  // ---- Stages ---------------------------------------------------------------

  async createStage(parentStageId: string, dto: UpsertStageDto, actorUserId: string, ip?: string) {
    const maxSort = await this.prisma.stage.aggregate({ where: { parentStageId }, _max: { sortOrder: true } });
    const stage = await this.prisma.stage.create({
      data: { parentStageId, ...dto, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "STAGE_CREATED",
      objectType: "Stage",
      objectId: stage.id,
      newValue: dto,
      ipAddress: ip,
    });
    return stage;
  }

  async updateStage(id: string, dto: UpsertStageDto, actorUserId: string, ip?: string) {
    const stage = await this.prisma.stage.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: actorUserId,
      action: "STAGE_UPDATED",
      objectType: "Stage",
      objectId: id,
      newValue: dto,
      ipAddress: ip,
    });
    return stage;
  }

  /** Same FK-safety-net as deleteRequirement/deleteParentStage:
   * ProjectStage.stageId has no ON DELETE CASCADE. */
  async deleteStage(id: string, actorUserId: string, ip?: string) {
    try {
      await this.prisma.stage.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
        throw new ConflictException(
          "This stage is already in use by one or more projects and can't be removed. Deactivate this template and create a new version for future projects instead.",
        );
      }
      throw err;
    }
    await this.audit.log({ userId: actorUserId, action: "STAGE_DELETED", objectType: "Stage", objectId: id, ipAddress: ip });
    return { ok: true };
  }

  async reorderStages(parentStageId: string, dto: ReorderDto, actorUserId: string, ip?: string) {
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) => this.prisma.stage.update({ where: { id }, data: { sortOrder: index + 1 } })),
    );
    await this.audit.log({
      userId: actorUserId,
      action: "STAGES_REORDERED",
      objectType: "ParentStage",
      objectId: parentStageId,
      newValue: dto.orderedIds,
      ipAddress: ip,
    });
    return { ok: true };
  }

  // ---- Document requirements -------------------------------------------------

  async createRequirement(stageId: string, dto: UpsertRequirementDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.stageDocumentRequirement.findUnique({
      where: { stageId_documentTypeId: { stageId, documentTypeId: dto.documentTypeId } },
    });
    if (existing) throw new ConflictException("That document type is already required at this stage");
    const requirement = await this.prisma.stageDocumentRequirement.create({
      data: { stageId, ...dto },
      include: { documentType: true },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "STAGE_DOCUMENT_REQUIREMENT_CREATED",
      objectType: "StageDocumentRequirement",
      objectId: requirement.id,
      newValue: dto,
      ipAddress: ip,
    });
    return requirement;
  }

  async updateRequirement(id: string, dto: Partial<UpsertRequirementDto>, actorUserId: string, ip?: string) {
    const before = await this.prisma.stageDocumentRequirement.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Stage document requirement not found");
    const requirement = await this.prisma.stageDocumentRequirement.update({
      where: { id },
      data: dto,
      include: { documentType: true },
    });
    await this.audit.log({
      userId: actorUserId,
      action: "STAGE_DOCUMENT_REQUIREMENT_UPDATED",
      objectType: "StageDocumentRequirement",
      objectId: id,
      newValue: dto,
      ipAddress: ip,
    });
    return requirement;
  }

  /** ProjectDocumentRequirement.stageDocumentRequirementId references this
   * without ON DELETE CASCADE (deliberately, per schema.prisma) - as soon
   * as any project instantiates this template (ProjectsService.create/
   * update -> instantiateForProject), every requirement in it gets its own
   * ProjectDocumentRequirement row, which makes a raw delete here fail
   * with a foreign key violation. Silently swallowed by the frontend until
   * now (no try/catch there either - fixed alongside this), which is
   * exactly why removing a requirement looked like it did nothing: it was
   * failing every time on any template already in use, with zero feedback
   * either way. */
  async deleteRequirement(id: string, actorUserId: string, ip?: string) {
    try {
      await this.prisma.stageDocumentRequirement.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
        throw new ConflictException(
          "This requirement is already in use by one or more projects (it was instantiated into their checklists) and can't be removed from the template. Mark it Not Applicable on those specific projects instead, or deactivate this template and create a new version for future projects.",
        );
      }
      throw err;
    }
    await this.audit.log({
      userId: actorUserId,
      action: "STAGE_DOCUMENT_REQUIREMENT_DELETED",
      objectType: "StageDocumentRequirement",
      objectId: id,
      ipAddress: ip,
    });
    return { ok: true };
  }

  // ---- Project instantiation & checklist (spec §55, §73) ---------------------

  /** Clones the project's assigned template into ProjectStage/
   * ProjectDocumentRequirement rows. Idempotent (upsert-based) so it's safe
   * to call again after the template gains new stages/requirements - existing
   * rows (and any project-level overrides on them) are left alone. */
  async instantiateForProject(projectId: string, actorUserId: string, ip?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    if (!project.workflowTemplateId) {
      throw new BadRequestException("This project has no workflow template assigned");
    }
    const template = await this.getTemplate(project.workflowTemplateId);

    let stagesTouched = 0;
    let requirementsTouched = 0;
    for (const parent of template.parentStages) {
      for (const stage of parent.stages) {
        const projectStage = await this.prisma.projectStage.upsert({
          where: { projectId_stageId: { projectId, stageId: stage.id } },
          update: {},
          create: { projectId, stageId: stage.id },
        });
        stagesTouched += 1;

        for (const requirement of stage.documentRequirements) {
          await this.prisma.projectDocumentRequirement.upsert({
            where: {
              projectStageId_stageDocumentRequirementId: {
                projectStageId: projectStage.id,
                stageDocumentRequirementId: requirement.id,
              },
            },
            update: {},
            create: { projectStageId: projectStage.id, stageDocumentRequirementId: requirement.id },
          });
          requirementsTouched += 1;
        }

        // A stage with zero requirements (or all-optional/N-A ones) should
        // read as COMPLETED immediately, not sit at the schema default of
        // INCOMPLETE until some unrelated event happens to recompute it.
        await this.recomputeProjectStageStatus(projectStage.id, actorUserId, "Workflow instantiated");
      }
    }

    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_WORKFLOW_INSTANTIATED",
      objectType: "Project",
      objectId: projectId,
      newValue: { templateId: template.id, stagesTouched, requirementsTouched },
      ipAddress: ip,
    });
    return this.getProjectWorkflow(projectId);
  }

  private toDocStatus(currentVersionStatus: string | undefined): RequirementDocStatus {
    if (!currentVersionStatus) return "NONE";
    if (currentVersionStatus === "APPROVED") return "APPROVED";
    if (currentVersionStatus === "REJECTED") return "REJECTED";
    return "PENDING";
  }

  async getProjectWorkflow(projectId: string) {
    const stages = await this.prisma.projectStage.findMany({
      where: { projectId },
      include: {
        stage: {
          include: { parentStage: true },
        },
        documentRequirements: {
          include: {
            stageDocumentRequirement: { include: { documentType: true } },
            documents: { include: { currentVersion: true }, orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    return stages
      .map((ps) => ({
        id: ps.id,
        status: ps.status,
        stage: { id: ps.stage.id, code: ps.stage.code, name: ps.stage.name, sortOrder: ps.stage.sortOrder },
        parentStage: {
          id: ps.stage.parentStage.id,
          code: ps.stage.parentStage.code,
          name: ps.stage.parentStage.name,
          sortOrder: ps.stage.parentStage.sortOrder,
        },
        requirements: ps.documentRequirements.map((r) => ({
          id: r.id,
          required: r.required,
          notApplicable: r.notApplicable,
          overrideReason: r.overrideReason,
          mandatory: r.stageDocumentRequirement.mandatory,
          documentType: r.stageDocumentRequirement.documentType,
          documentId: r.documents[0]?.id ?? null,
          docStatus: this.toDocStatus(r.documents[0]?.currentVersion?.status),
        })),
      }))
      .sort((a, b) => a.parentStage.sortOrder - b.parentStage.sortOrder || a.stage.sortOrder - b.stage.sortOrder);
  }

  /** Recomputes and persists one stage's status, recording a history row on
   * change. Called after any requirement override, and (in Phase 4) after
   * every document approval/rejection. */
  async recomputeProjectStageStatus(projectStageId: string, actorUserId?: string, comment?: string) {
    const projectStage = await this.prisma.projectStage.findUniqueOrThrow({
      where: { id: projectStageId },
      include: {
        documentRequirements: {
          include: {
            stageDocumentRequirement: true,
            documents: { include: { currentVersion: true }, orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    const newStatus = computeStageStatus(
      projectStage.documentRequirements.map((r) => ({
        mandatory: r.stageDocumentRequirement.mandatory,
        required: r.required,
        notApplicable: r.notApplicable,
        docStatus: this.toDocStatus(r.documents[0]?.currentVersion?.status),
      })),
    );

    if (newStatus === projectStage.status) return projectStage;

    const updated = await this.prisma.projectStage.update({
      where: { id: projectStageId },
      data: {
        status: newStatus,
        startedAt: projectStage.startedAt ?? new Date(),
        completedAt: newStatus === "COMPLETED" ? new Date() : null,
      },
    });
    await this.prisma.projectStageHistory.create({
      data: {
        projectStageId,
        previousStatus: projectStage.status,
        newStatus,
        userId: actorUserId,
        comment,
      },
    });
    return updated;
  }

  async overrideProjectRequirement(id: string, dto: OverrideProjectRequirementDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.projectDocumentRequirement.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Project document requirement not found");

    const updated = await this.prisma.projectDocumentRequirement.update({
      where: { id },
      data: {
        required: dto.required ?? before.required,
        notApplicable: dto.notApplicable ?? before.notApplicable,
        overrideReason: dto.reason,
        overriddenById: actorUserId,
      },
      include: { stageDocumentRequirement: { include: { documentType: true } } },
    });

    await this.audit.log({
      userId: actorUserId,
      action: "PROJECT_DOCUMENT_REQUIREMENT_OVERRIDDEN",
      objectType: "ProjectDocumentRequirement",
      objectId: id,
      oldValue: { required: before.required, notApplicable: before.notApplicable },
      newValue: dto,
      ipAddress: ip,
    });

    await this.recomputeProjectStageStatus(before.projectStageId, actorUserId, `Requirement override: ${dto.reason}`);
    return updated;
  }
}
