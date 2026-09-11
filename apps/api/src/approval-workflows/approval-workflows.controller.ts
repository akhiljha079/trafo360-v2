import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { AuditService } from "../common/audit.service";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertApprovalWorkflowDto } from "./dto/upsert-approval-workflow.dto";

@Controller("approval-workflows")
export class ApprovalWorkflowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Auth()
  list() {
    return this.prisma.approvalWorkflow.findMany({
      include: {
        steps: {
          orderBy: { sortOrder: "asc" },
          include: {
            approverRole: { select: { id: true, name: true } },
            approverDepartment: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
  }

  @Post()
  @Auth("workflow.edit")
  async create(@Body() dto: UpsertApprovalWorkflowDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const existing = await this.prisma.approvalWorkflow.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException("An approval workflow with that name already exists");

    const workflow = await this.prisma.approvalWorkflow.create({
      data: {
        name: dto.name,
        description: dto.description,
        steps: {
          create: dto.steps.map((s, i) => ({
            sortOrder: i + 1,
            approverRoleId: s.approverRoleId,
            approverDepartmentId: s.approverDepartmentId,
          })),
        },
      },
      include: { steps: true },
    });
    await this.audit.log({
      userId,
      action: "APPROVAL_WORKFLOW_CREATED",
      objectType: "ApprovalWorkflow",
      objectId: workflow.id,
      newValue: dto,
      ipAddress: ip,
    });
    return workflow;
  }

  @Put(":id")
  @Auth("workflow.edit")
  async update(
    @Param("id") id: string,
    @Body() dto: UpsertApprovalWorkflowDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    const before = await this.prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Approval workflow not found");

    await this.prisma.$transaction([
      this.prisma.approvalStep.deleteMany({ where: { approvalWorkflowId: id } }),
      this.prisma.approvalWorkflow.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          steps: {
            create: dto.steps.map((s, i) => ({
              sortOrder: i + 1,
              approverRoleId: s.approverRoleId,
              approverDepartmentId: s.approverDepartmentId,
            })),
          },
        },
      }),
    ]);

    await this.audit.log({
      userId,
      action: "APPROVAL_WORKFLOW_UPDATED",
      objectType: "ApprovalWorkflow",
      objectId: id,
      newValue: dto,
      ipAddress: ip,
    });
    return this.prisma.approvalWorkflow.findUnique({ where: { id }, include: { steps: true } });
  }
}
