import { BadRequestException, Injectable } from "@nestjs/common";
import { PermissionsService } from "../common/permissions.service";
import { PrismaService } from "../prisma/prisma.service";

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
}

export const REPORT_TYPES = ["project-status", "document-register", "physical-file-register", "overdue-extensions"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Report data assembly (spec §42). Every query here reuses the same
 * `confidentialityLevel.rank <= ceiling` filter the rest of the app enforces
 * on reads - a report is just another read path, and exporting one must not
 * become a way to see more than the UI would ever show. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getReport(type: ReportType, userId: string): Promise<ReportResult> {
    const ceiling = await this.permissions.getConfidentialityRank(userId);
    switch (type) {
      case "project-status":
        return this.projectStatusReport(ceiling);
      case "document-register":
        return this.documentRegisterReport(ceiling);
      case "physical-file-register":
        return this.physicalFileRegisterReport(ceiling);
      case "overdue-extensions":
        return this.overdueExtensionsReport(ceiling);
      default:
        throw new BadRequestException(`Unknown report type "${type}"`);
    }
  }

  private async projectStatusReport(ceiling: number): Promise<ReportResult> {
    const projects = await this.prisma.project.findMany({
      where: { confidentialityLevel: { rank: { lte: ceiling } } },
      include: {
        customer: { select: { name: true } },
        stages: { select: { status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const rows = projects.map((p) => {
      const total = p.stages.length;
      const completed = p.stages.filter((s) => s.status === "COMPLETED").length;
      const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
      return {
        projectNo: p.projectNo,
        name: p.name,
        customer: p.customer.name,
        status: p.status,
        stagesCompleted: `${completed}/${total}`,
        completionPercent: percent,
        targetDeliveryDate: p.targetDeliveryDate?.toISOString().slice(0, 10) ?? "",
      };
    });

    return {
      title: "Project Status Report",
      columns: [
        { key: "projectNo", label: "Project No" },
        { key: "name", label: "Project Name" },
        { key: "customer", label: "Customer" },
        { key: "status", label: "Status" },
        { key: "stagesCompleted", label: "Stages Completed" },
        { key: "completionPercent", label: "Completion %" },
        { key: "targetDeliveryDate", label: "Target Delivery" },
      ],
      rows,
    };
  }

  private async documentRegisterReport(ceiling: number): Promise<ReportResult> {
    const documents = await this.prisma.document.findMany({
      where: { confidentialityLevel: { rank: { lte: ceiling } } },
      include: {
        project: { select: { projectNo: true, name: true } },
        documentType: { select: { name: true } },
        confidentialityLevel: { select: { name: true } },
        currentVersion: { select: { versionNo: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    return {
      title: "Document Register",
      columns: [
        { key: "projectNo", label: "Project No" },
        { key: "title", label: "Document Title" },
        { key: "documentType", label: "Document Type" },
        { key: "confidentiality", label: "Confidentiality" },
        { key: "status", label: "Status" },
        { key: "currentVersion", label: "Current Version" },
        { key: "lastUpdated", label: "Last Updated" },
      ],
      rows: documents.map((d) => ({
        projectNo: d.project.projectNo,
        title: d.title,
        documentType: d.documentType.name,
        confidentiality: d.confidentialityLevel.name,
        status: d.status,
        currentVersion: d.currentVersion?.versionNo ?? "",
        lastUpdated: (d.currentVersion?.createdAt ?? d.createdAt).toISOString().slice(0, 10),
      })),
    };
  }

  private async physicalFileRegisterReport(ceiling: number): Promise<ReportResult> {
    const files = await this.prisma.physicalFile.findMany({
      where: { confidentialityLevel: { rank: { lte: ceiling } } },
      include: {
        project: { select: { projectNo: true, name: true } },
        confidentialityLevel: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      title: "Physical File Register",
      columns: [
        { key: "fileCode", label: "File Code" },
        { key: "projectNo", label: "Project No" },
        { key: "confidentiality", label: "Confidentiality" },
        { key: "status", label: "Status" },
        { key: "location", label: "Location" },
      ],
      rows: files.map((f) => ({
        fileCode: f.fileCode,
        projectNo: f.project.projectNo,
        confidentiality: f.confidentialityLevel.name,
        status: f.status,
        location: [f.building, f.floor, f.room, f.rack, f.shelf, f.box].filter(Boolean).join(" / ") || f.archiveLocation || "",
      })),
    };
  }

  private async overdueExtensionsReport(ceiling: number): Promise<ReportResult> {
    const transactions = await this.prisma.fileIssueTransaction.findMany({
      where: {
        status: { in: ["OVERDUE", "EXTENSION_REQUESTED"] },
        physicalFile: { confidentialityLevel: { rank: { lte: ceiling } } },
      },
      include: {
        physicalFile: { select: { fileCode: true, project: { select: { projectNo: true } } } },
        requester: { select: { name: true } },
        extensions: { where: { status: "REQUESTED" }, select: { requestedDueDate: true, reason: true } },
      },
      orderBy: { dueDate: "asc" },
    });

    return {
      title: "Overdue / Extension-Requested Physical Files",
      columns: [
        { key: "fileCode", label: "File Code" },
        { key: "projectNo", label: "Project No" },
        { key: "requester", label: "Held By" },
        { key: "dueDate", label: "Due Date" },
        { key: "status", label: "Status" },
        { key: "requestedNewDueDate", label: "Requested New Due Date" },
      ],
      rows: transactions.map((t) => ({
        fileCode: t.physicalFile.fileCode,
        projectNo: t.physicalFile.project.projectNo,
        requester: t.requester.name,
        dueDate: t.dueDate?.toISOString().slice(0, 10) ?? "",
        status: t.status,
        requestedNewDueDate: t.extensions[0]?.requestedDueDate.toISOString().slice(0, 10) ?? "",
      })),
    };
  }
}
