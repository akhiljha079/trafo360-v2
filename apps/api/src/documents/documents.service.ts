import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { NOTIFICATION_EVENTS } from "@trafo360/shared";
import { AuditService } from "../common/audit.service";
import { PermissionsService } from "../common/permissions.service";
import { DocumentRequestsService } from "../document-requests/document-requests.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { WorkflowService } from "../workflow/workflow.service";
import { DecideApprovalDto } from "./dto/decide-approval.dto";
import { UploadDocumentDto } from "./dto/upload-document.dto";

// Deliberately conservative whitelist (spec §19/§48) - extend as real
// document types demand it, never widen to "anything".
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "application/zip",
  "application/dxf",
  "image/vnd.dwg",
  "application/acad",
]);
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB - matches nginx client_max_body_size

const documentInclude = {
  documentType: true,
  confidentialityLevel: true,
  createdBy: { select: { id: true, name: true } },
  project: { select: { id: true, projectNo: true, name: true } },
  versions: {
    orderBy: { versionNo: "desc" as const },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      approvals: { include: { approver: { select: { id: true, name: true } } } },
    },
  },
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionsService,
    private readonly workflow: WorkflowService,
    private readonly documentRequests: DocumentRequestsService,
    private readonly notifications: NotificationsService,
  ) {}

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  }

  private validateFile(file: Express.Multer.File) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`File type "${file.mimetype}" is not permitted`);
    }
  }

  async listForProject(projectId: string, userId: string) {
    const ceiling = await this.permissions.getConfidentialityRank(userId);
    return this.prisma.document.findMany({
      where: { projectId, confidentialityLevel: { rank: { lte: ceiling } } },
      include: documentInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Document Library (spec §24) - across every project the user's
   * confidentiality ceiling permits, not scoped to one project. */
  async listAll(userId: string, search?: string) {
    const ceiling = await this.permissions.getConfidentialityRank(userId);
    return this.prisma.document.findMany({
      where: {
        confidentialityLevel: { rank: { lte: ceiling } },
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                { project: { projectNo: { contains: search, mode: "insensitive" as const } } },
                { project: { name: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: documentInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async get(id: string, userId: string) {
    const document = await this.prisma.document.findUnique({ where: { id }, include: documentInclude });
    if (!document) throw new NotFoundException("Document not found");
    const ceiling = await this.permissions.getConfidentialityRank(userId);
    if (document.confidentialityLevel.rank > ceiling) {
      throw new ForbiddenException("This document's confidentiality level exceeds your access");
    }
    return document;
  }

  async upload(projectId: string, dto: UploadDocumentDto, file: Express.Multer.File, userId: string, ip?: string) {
    this.validateFile(file);

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    let documentId = dto.documentId;
    let documentTypeId = dto.documentTypeId;
    let confidentialityLevelId = dto.confidentialityLevelId ?? project.confidentialityLevelId;
    let projectDocumentRequirementId = dto.projectDocumentRequirementId;

    if (documentId) {
      const existing = await this.prisma.document.findUnique({ where: { id: documentId } });
      if (!existing) throw new NotFoundException("Document not found");
      documentTypeId = existing.documentTypeId;
      confidentialityLevelId = existing.confidentialityLevelId;
      projectDocumentRequirementId = existing.projectDocumentRequirementId ?? undefined;
    } else {
      if (!documentTypeId) throw new BadRequestException("documentTypeId is required for a new document");
      const documentType = await this.prisma.documentType.findUnique({ where: { id: documentTypeId } });
      if (!documentType) throw new NotFoundException("Document type not found");
      const document = await this.prisma.document.create({
        data: {
          projectId,
          documentTypeId,
          projectDocumentRequirementId,
          confidentialityLevelId,
          title: dto.title ?? documentType.name,
          status: "DRAFT",
          createdById: userId,
        },
      });
      documentId = document.id;
    }

    const versionCount = await this.prisma.documentVersion.count({ where: { documentId } });
    const versionNo = versionCount + 1;

    const safeName = this.sanitizeFileName(file.originalname);
    const relativePath = path.posix.join(
      "projects",
      projectId,
      documentTypeId!,
      documentId,
      `v${versionNo}-${crypto.randomUUID()}-${safeName}`,
    );
    const written = await this.storage.write(file.buffer, relativePath);

    // Approval requirement comes from the stage-document-requirement this
    // upload is fulfilling, if any (spec §22).
    let requirement: { approvalRequired: boolean; approvalWorkflowId: string | null } | null = null;
    if (projectDocumentRequirementId) {
      const pdr = await this.prisma.projectDocumentRequirement.findUnique({
        where: { id: projectDocumentRequirementId },
        include: { stageDocumentRequirement: true },
      });
      if (pdr) requirement = pdr.stageDocumentRequirement;
    }

    const needsApproval = requirement?.approvalRequired && requirement.approvalWorkflowId;
    const version = await this.prisma.documentVersion.create({
      data: {
        documentId,
        versionNo,
        fileName: safeName,
        storagePath: written.storagePath,
        storageStatus: written.storageStatus,
        checksum: written.checksum,
        sizeBytes: written.sizeBytes,
        mimeType: file.mimetype,
        status: needsApproval ? "UNDER_REVIEW" : "APPROVED",
        revisionReason: dto.revisionReason,
        uploadedById: userId,
      },
    });

    if (needsApproval) {
      const steps = await this.prisma.approvalStep.findMany({
        where: { approvalWorkflowId: requirement!.approvalWorkflowId! },
        orderBy: { sortOrder: "asc" },
      });
      await this.prisma.documentApproval.createMany({
        data: steps.map((s) => ({ documentVersionId: version.id, approvalStepId: s.id, decision: "PENDING" })),
      });
      // Deliberately does NOT touch currentVersionId here: if an earlier
      // version is still APPROVED, it stays the document's current/
      // downloadable version until this new one is actually approved -
      // otherwise a document with a pending revision would show as
      // "rejected" if that revision gets rejected, hiding a perfectly good
      // earlier approved version. See docs/BUILD_PROGRESS.md for the bug
      // this fixes and how it was found.
      await this.prisma.document.update({ where: { id: documentId }, data: { status: "UNDER_REVIEW" } });
      await this.notifyApprovers(steps, dto.title ?? "Document", project.projectNo);
    } else {
      await this.markSupersededAndPromote(documentId, version.id);
    }

    await this.audit.log({
      userId,
      action: "DOCUMENT_UPLOADED",
      objectType: "Document",
      objectId: documentId,
      newValue: { versionNo, fileName: safeName, checksum: written.checksum, storageStatus: written.storageStatus },
      ipAddress: ip,
    });

    if (projectDocumentRequirementId) {
      const pdr = await this.prisma.projectDocumentRequirement.findUnique({ where: { id: projectDocumentRequirementId } });
      if (pdr) await this.workflow.recomputeProjectStageStatus(pdr.projectStageId, userId, "Document uploaded");
    }

    return this.get(documentId, userId);
  }

  /** The single place a version actually becomes "current": marks whatever
   * was previously current as SUPERSEDED (if it's a different version - an
   * unreviewed document being auto-approved for the first time has no
   * prior current version) and promotes the new one. Used both for
   * no-approval-required uploads and for the moment an approval chain
   * completes. */
  private async markSupersededAndPromote(documentId: string, newVersionId: string) {
    const document = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (document.currentVersionId && document.currentVersionId !== newVersionId) {
      await this.prisma.documentVersion.update({
        where: { id: document.currentVersionId },
        data: { status: "SUPERSEDED" },
      });
    }
    await this.prisma.documentVersion.update({ where: { id: newVersionId }, data: { status: "APPROVED" } });
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: "APPROVED", currentVersionId: newVersionId },
    });
  }

  async uploadVersionForExistingDocument(
    documentId: string,
    dto: UploadDocumentDto,
    file: Express.Multer.File,
    userId: string,
    ip?: string,
  ) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException("Document not found");
    return this.upload(document.projectId, { ...dto, documentId }, file, userId, ip);
  }

  private async recomputeAfterDecision(versionId: string, userId: string) {
    const version = await this.prisma.documentVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { document: true },
    });
    if (version.document.projectDocumentRequirementId) {
      const pdr = await this.prisma.projectDocumentRequirement.findUnique({
        where: { id: version.document.projectDocumentRequirementId },
      });
      if (pdr) await this.workflow.recomputeProjectStageStatus(pdr.projectStageId, userId, "Document approval decision");
    }
  }

  /** Notifies every user routed to at least one of the given approval
   * steps. An unassigned step (no role/department) has no one to notify -
   * matches assertCanDecide()'s "anyone with the permission can act"
   * semantics for that case. */
  private async notifyApprovers(steps: { approverRoleId: string | null; approverDepartmentId: string | null }[], documentTitle: string, projectNo: string) {
    const roleIds = steps.map((s) => s.approverRoleId).filter((x): x is string => !!x);
    const deptIds = steps.map((s) => s.approverDepartmentId).filter((x): x is string => !!x);
    if (roleIds.length === 0 && deptIds.length === 0) return;

    const approvers = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        OR: [...(roleIds.length ? [{ roleId: { in: roleIds } }] : []), ...(deptIds.length ? [{ departmentId: { in: deptIds } }] : [])],
      },
    });
    for (const approver of approvers) {
      await this.notifications.notify(NOTIFICATION_EVENTS.DOCUMENT_APPROVAL_PENDING, approver.id, {
        documentTitle,
        projectNo,
      });
    }
  }

  /** A route-level `document.approve`/`document.reject` permission is not
   * enough on its own - it would let any approver-capable user decide any
   * step, regardless of whether it was actually routed to their role/
   * department (architecture plan §5's resource-level check). A step with
   * neither `approverRoleId` nor `approverDepartmentId` set is unassigned
   * and can be acted on by anyone with the route permission. */
  private async assertCanDecide(approvalId: string, userId: string) {
    const step = await this.prisma.approvalStep.findFirst({
      where: { documentApprovals: { some: { id: approvalId } } },
    });
    if (!step || (!step.approverRoleId && !step.approverDepartmentId)) return;

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const roleMatches = step.approverRoleId && step.approverRoleId === user.roleId;
    const deptMatches = step.approverDepartmentId && step.approverDepartmentId === user.departmentId;
    if (!roleMatches && !deptMatches) {
      throw new ForbiddenException("This approval step is not routed to your role or department");
    }
  }

  async approve(approvalId: string, dto: DecideApprovalDto, userId: string, ip?: string) {
    const approval = await this.prisma.documentApproval.findUnique({
      where: { id: approvalId },
      include: { documentVersion: { include: { approvals: true, document: true } } },
    });
    if (!approval) throw new NotFoundException("Approval step not found");
    if (approval.decision !== "PENDING") throw new BadRequestException("This approval step was already decided");
    await this.assertCanDecide(approvalId, userId);

    await this.prisma.documentApproval.update({
      where: { id: approvalId },
      data: { decision: "APPROVED", approverId: userId, comment: dto.comment, decidedAt: new Date() },
    });

    const allSteps = await this.prisma.documentApproval.findMany({
      where: { documentVersionId: approval.documentVersionId },
    });
    const allApproved = allSteps.every((s) => s.id === approvalId || s.decision === "APPROVED");

    if (allApproved) {
      await this.markSupersededAndPromote(approval.documentVersion.document.id, approval.documentVersionId);
      await this.notifications.notify(NOTIFICATION_EVENTS.DOCUMENT_APPROVED, approval.documentVersion.document.createdById, {
        documentTitle: approval.documentVersion.document.title,
      });
    }

    await this.audit.log({
      userId,
      action: "DOCUMENT_APPROVED",
      objectType: "DocumentVersion",
      objectId: approval.documentVersionId,
      reason: dto.comment,
      ipAddress: ip,
    });

    await this.recomputeAfterDecision(approval.documentVersionId, userId);
    return { ok: true, versionFullyApproved: allApproved };
  }

  async reject(approvalId: string, dto: DecideApprovalDto, userId: string, ip?: string) {
    const approval = await this.prisma.documentApproval.findUnique({
      where: { id: approvalId },
      include: { documentVersion: { include: { document: true } } },
    });
    if (!approval) throw new NotFoundException("Approval step not found");
    if (approval.decision !== "PENDING") throw new BadRequestException("This approval step was already decided");
    await this.assertCanDecide(approvalId, userId);

    await this.prisma.documentApproval.update({
      where: { id: approvalId },
      data: { decision: "REJECTED", approverId: userId, comment: dto.comment, decidedAt: new Date() },
    });
    await this.prisma.documentVersion.update({ where: { id: approval.documentVersionId }, data: { status: "REJECTED" } });
    // A rejected revision doesn't erase a still-good, previously-approved
    // version - the document stays at its last known-good state (spec §22:
    // "rejected documents must allow resubmission as a new version",
    // implying the prior approved version remains valid meanwhile). Only
    // fall back to REJECTED at the document level if there was never an
    // approved version to begin with.
    await this.prisma.document.update({
      where: { id: approval.documentVersion.document.id },
      data: { status: approval.documentVersion.document.currentVersionId ? "APPROVED" : "REJECTED" },
    });
    await this.notifications.notify(NOTIFICATION_EVENTS.DOCUMENT_REJECTED, approval.documentVersion.document.createdById, {
      documentTitle: approval.documentVersion.document.title,
      comment: dto.comment ?? "",
    });

    await this.audit.log({
      userId,
      action: "DOCUMENT_REJECTED",
      objectType: "DocumentVersion",
      objectId: approval.documentVersionId,
      reason: dto.comment,
      ipAddress: ip,
    });

    await this.recomputeAfterDecision(approval.documentVersionId, userId);
    return { ok: true };
  }

  async listPendingApprovalsForUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.prisma.documentApproval.findMany({
      where: {
        decision: "PENDING",
        approvalStep: {
          OR: [{ approverRoleId: user.roleId ?? undefined }, { approverDepartmentId: user.departmentId ?? undefined }],
        },
      },
      include: {
        documentVersion: { include: { document: { include: { documentType: true, project: true } } } },
        approvalStep: true,
      },
    });
  }

  /** Streams the file for a download - resolves storage server-side, never
   * a raw path; confidentiality-checked; audit-logged before the stream
   * starts (spec §49). Highly-confidential/restricted approval-gated
   * downloads (spec §23) are deferred to Phase 5's DocumentRequest flow -
   * the confidentiality *ceiling* check below is enforced now, the
   * additional per-download approval step is not yet. */
  async prepareDownload(versionId: string, userId: string, ip?: string) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { confidentialityLevel: true } } },
    });
    if (!version) throw new NotFoundException("Document version not found");

    const ceiling = await this.permissions.getConfidentialityRank(userId);
    if (version.document.confidentialityLevel.rank > ceiling) {
      throw new ForbiddenException("This document's confidentiality level exceeds your access");
    }

    // Spec §23: HIGHLY_CONFIDENTIAL/RESTRICTED downloads need an approved
    // request even for users whose ceiling would otherwise permit it - the
    // gap flagged in Phase 4 (see docs/BUILD_PROGRESS.md), closed here now
    // that DocumentRequestsService exists.
    if (version.document.confidentialityLevel.requiresApprovalForDownload) {
      const approved = await this.documentRequests.hasApprovedRequest(version.document.id, userId);
      if (!approved) {
        throw new ForbiddenException(
          "This document requires an approved access request before it can be downloaded",
        );
      }
    }

    const buffer = await this.storage.read(version.storagePath, version.storageStatus);
    await this.audit.log({
      userId,
      action: "DOCUMENT_DOWNLOADED",
      objectType: "DocumentVersion",
      objectId: version.id,
      ipAddress: ip,
    });
    return { buffer, fileName: version.fileName, mimeType: version.mimeType };
  }
}
