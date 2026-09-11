import { Injectable } from "@nestjs/common";
import { PermissionsService } from "../common/permissions.service";
import { PrismaService } from "../prisma/prisma.service";

const ACTIVE_PROJECT_STATUSES = [
  "ORDER_RECEIVED",
  "ENGINEERING",
  "PROCUREMENT",
  "MANUFACTURING",
  "TESTING",
  "QA_REVIEW",
  "READY_FOR_DISPATCH",
  "PROJECT_CLOSURE",
];

/** Role-scoped dashboard KPIs (spec §39/§40). Every count here is filtered
 * by the same confidentiality ceiling used everywhere else, so a user never
 * sees a number that hints at a project/document they can't open. */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getSummary(userId: string) {
    const [user, ceiling] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.permissions.getConfidentialityRank(userId),
    ]);

    const visibleProjectWhere = { confidentialityLevel: { rank: { lte: ceiling } } };

    const [
      activeProjects,
      pendingApprovals,
      filesIssued,
      overdueFiles,
      stageStatusCounts,
      recentProjects,
    ] = await Promise.all([
      this.prisma.project.count({ where: { ...visibleProjectWhere, status: { in: ACTIVE_PROJECT_STATUSES } } }),
      this.prisma.documentApproval.count({
        where: {
          decision: "PENDING",
          approvalStep: {
            OR: [{ approverRoleId: user.roleId ?? undefined }, { approverDepartmentId: user.departmentId ?? undefined }],
          },
        },
      }),
      this.prisma.fileIssueTransaction.count({
        where: { status: "ISSUED", physicalFile: { confidentialityLevel: { rank: { lte: ceiling } } } },
      }),
      this.prisma.fileIssueTransaction.count({
        where: { status: "OVERDUE", physicalFile: { confidentialityLevel: { rank: { lte: ceiling } } } },
      }),
      this.prisma.projectStage.groupBy({
        by: ["status"],
        where: { project: visibleProjectWhere },
        _count: true,
      }),
      this.prisma.project.findMany({
        where: visibleProjectWhere,
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, projectNo: true, name: true, status: true, updatedAt: true },
      }),
    ]);

    return {
      activeProjects,
      pendingApprovalsForMe: pendingApprovals,
      filesIssued,
      overdueFiles,
      stageStatusBreakdown: Object.fromEntries(stageStatusCounts.map((row) => [row.status, row._count])),
      recentProjects,
    };
  }
}
