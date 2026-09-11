import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { NOTIFICATION_EVENTS } from "@trafo360/shared";
import { AuditService } from "../common/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { RequestExtensionDto, RequestFileIssueDto, ReturnFileDto } from "./dto/file-issue.dto";

const transactionInclude = {
  physicalFile: { include: { project: { select: { id: true, projectNo: true, name: true } }, confidentialityLevel: true } },
  requester: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  extensions: { orderBy: { createdAt: "desc" as const } },
  returnTransaction: true,
} as const;

@Injectable()
export class FileIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(filters: { status?: string; overdue?: boolean; requesterId?: string; physicalFileId?: string }) {
    return this.prisma.fileIssueTransaction.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.overdue ? { status: "OVERDUE" } : {}),
        ...(filters.requesterId ? { requesterId: filters.requesterId } : {}),
        ...(filters.physicalFileId ? { physicalFileId: filters.physicalFileId } : {}),
      },
      include: transactionInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string) {
    const transaction = await this.prisma.fileIssueTransaction.findUnique({ where: { id }, include: transactionInclude });
    if (!transaction) throw new NotFoundException("File issue transaction not found");
    return transaction;
  }

  /** Spec §28: a user requests a physical file. Approval routing depends on
   * the file's confidentiality (spec §29) - handled in approve()/issue()
   * below, not here, since whether approval is needed is a property of the
   * file, checked at the point it matters. */
  async requestIssue(physicalFileId: string, dto: RequestFileIssueDto, userId: string, ip?: string) {
    const physicalFile = await this.prisma.physicalFile.findUnique({ where: { id: physicalFileId } });
    if (!physicalFile) throw new NotFoundException("Physical file not found");
    if (physicalFile.status !== "AVAILABLE") {
      throw new ConflictException(`This physical file is not available (current status: ${physicalFile.status})`);
    }

    const transaction = await this.prisma.fileIssueTransaction.create({
      data: {
        physicalFileId,
        requesterId: userId,
        purpose: dto.purpose,
        departmentId: dto.departmentId,
        dueDate: new Date(dto.dueDate),
        status: "REQUESTED",
      },
      include: transactionInclude,
    });
    await this.audit.log({
      userId,
      action: "FILE_ISSUE_REQUESTED",
      objectType: "FileIssueTransaction",
      objectId: transaction.id,
      newValue: dto,
      ipAddress: ip,
    });
    return transaction;
  }

  async approve(id: string, userId: string, ip?: string) {
    const transaction = await this.get(id);
    if (transaction.status !== "REQUESTED") {
      throw new BadRequestException(`Cannot approve from status ${transaction.status}`);
    }
    const updated = await this.prisma.fileIssueTransaction.update({
      where: { id },
      data: { status: "APPROVED", approvedById: userId },
      include: transactionInclude,
    });
    await this.audit.log({ userId, action: "FILE_ISSUE_APPROVED", objectType: "FileIssueTransaction", objectId: id, ipAddress: ip });
    return updated;
  }

  /** Confidentiality-gated: HIGHLY_CONFIDENTIAL/RESTRICTED files must go
   * through approve() first (spec §23/§29); everything else can be issued
   * directly from REQUESTED. */
  async issue(id: string, userId: string, ip?: string) {
    const transaction = await this.get(id);
    const needsApproval = transaction.physicalFile.confidentialityLevel.requiresApprovalForPhysicalIssue;

    if (needsApproval && transaction.status !== "APPROVED") {
      throw new BadRequestException("This file's confidentiality level requires approval before it can be issued");
    }
    if (!needsApproval && !["REQUESTED", "APPROVED"].includes(transaction.status)) {
      throw new BadRequestException(`Cannot issue from status ${transaction.status}`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.fileIssueTransaction.update({
        where: { id },
        data: { status: "ISSUED", issuedById: userId, issueDate: new Date() },
        include: transactionInclude,
      }),
      this.prisma.physicalFile.update({ where: { id: transaction.physicalFileId }, data: { status: "ISSUED" } }),
    ]);
    await this.audit.log({ userId, action: "FILE_ISSUED", objectType: "FileIssueTransaction", objectId: id, ipAddress: ip });
    await this.notifications.notify(NOTIFICATION_EVENTS.FILE_ISSUED, updated.requesterId, {
      fileCode: updated.physicalFile.fileCode,
      dueDate: updated.dueDate?.toLocaleDateString() ?? "",
    });
    return updated;
  }

  async returnFile(id: string, dto: ReturnFileDto, userId: string, ip?: string) {
    const transaction = await this.get(id);
    if (!["ISSUED", "OVERDUE", "EXTENSION_REQUESTED"].includes(transaction.status)) {
      throw new BadRequestException(`Cannot return from status ${transaction.status}`);
    }

    const [, , updated] = await this.prisma.$transaction([
      this.prisma.fileReturnTransaction.create({
        data: { fileIssueTransactionId: id, returnedById: userId, receivedById: userId, condition: dto.condition, remarks: dto.remarks },
      }),
      this.prisma.physicalFile.update({ where: { id: transaction.physicalFileId }, data: { status: "AVAILABLE" } }),
      this.prisma.fileIssueTransaction.update({ where: { id }, data: { status: "RETURNED" }, include: transactionInclude }),
    ]);
    await this.audit.log({
      userId,
      action: "FILE_RETURNED",
      objectType: "FileIssueTransaction",
      objectId: id,
      newValue: dto,
      ipAddress: ip,
    });
    return updated;
  }

  /** Spec §32: extension does NOT auto-extend - it opens a fresh approval.
   * If rejected, the file must be returned by the *original* due date,
   * which is why dueDate is only ever mutated by approveExtension(). */
  async requestExtension(id: string, dto: RequestExtensionDto, userId: string, ip?: string) {
    const transaction = await this.get(id);
    if (!["ISSUED", "OVERDUE"].includes(transaction.status)) {
      throw new BadRequestException(`Cannot request an extension from status ${transaction.status}`);
    }
    const [extension] = await this.prisma.$transaction([
      this.prisma.extensionRequest.create({
        data: {
          fileIssueTransactionId: id,
          requestedDueDate: new Date(dto.requestedDueDate),
          reason: dto.reason,
          status: "REQUESTED",
        },
      }),
      this.prisma.fileIssueTransaction.update({ where: { id }, data: { status: "EXTENSION_REQUESTED" } }),
    ]);
    await this.audit.log({
      userId,
      action: "FILE_EXTENSION_REQUESTED",
      objectType: "ExtensionRequest",
      objectId: extension.id,
      newValue: dto,
      ipAddress: ip,
    });
    return extension;
  }

  async approveExtension(extensionId: string, userId: string, ip?: string) {
    const extension = await this.prisma.extensionRequest.findUnique({ where: { id: extensionId } });
    if (!extension) throw new NotFoundException("Extension request not found");
    if (extension.status !== "REQUESTED") throw new BadRequestException("This extension request was already decided");

    await this.prisma.$transaction([
      this.prisma.extensionRequest.update({
        where: { id: extensionId },
        data: { status: "APPROVED", decidedById: userId, decidedAt: new Date() },
      }),
      this.prisma.fileIssueTransaction.update({
        where: { id: extension.fileIssueTransactionId },
        data: { status: "ISSUED", dueDate: extension.requestedDueDate },
      }),
    ]);
    await this.audit.log({
      userId,
      action: "FILE_EXTENSION_APPROVED",
      objectType: "ExtensionRequest",
      objectId: extensionId,
      newValue: { newDueDate: extension.requestedDueDate },
      ipAddress: ip,
    });
    const transaction = await this.get(extension.fileIssueTransactionId);
    await this.notifications.notify(NOTIFICATION_EVENTS.FILE_EXTENSION_APPROVED, transaction.requesterId, {
      fileCode: transaction.physicalFile.fileCode,
      newDueDate: extension.requestedDueDate.toLocaleDateString(),
    });
    return transaction;
  }

  async rejectExtension(extensionId: string, userId: string, ip?: string) {
    const extension = await this.prisma.extensionRequest.findUnique({ where: { id: extensionId } });
    if (!extension) throw new NotFoundException("Extension request not found");
    if (extension.status !== "REQUESTED") throw new BadRequestException("This extension request was already decided");

    const transaction = await this.get(extension.fileIssueTransactionId);
    // Original due date stands - revert to OVERDUE if it's already past, else ISSUED.
    const revertedStatus = transaction.dueDate && transaction.dueDate < new Date() ? "OVERDUE" : "ISSUED";

    await this.prisma.$transaction([
      this.prisma.extensionRequest.update({
        where: { id: extensionId },
        data: { status: "REJECTED", decidedById: userId, decidedAt: new Date() },
      }),
      this.prisma.fileIssueTransaction.update({ where: { id: extension.fileIssueTransactionId }, data: { status: revertedStatus } }),
    ]);
    await this.audit.log({
      userId,
      action: "FILE_EXTENSION_REJECTED",
      objectType: "ExtensionRequest",
      objectId: extensionId,
      ipAddress: ip,
    });
    await this.notifications.notify(NOTIFICATION_EVENTS.FILE_EXTENSION_REJECTED, transaction.requesterId, {
      fileCode: transaction.physicalFile.fileCode,
      originalDueDate: transaction.dueDate?.toLocaleDateString() ?? "",
    });
    return this.get(extension.fileIssueTransactionId);
  }

  /** Overdue detection (spec §31) - called by the worker on a schedule.
   * Only flips ISSUED -> OVERDUE; the actual reminder email/WhatsApp send
   * is Phase 6, once there's a notification channel to send it through. */
  async markOverdueTransactions(): Promise<number> {
    const result = await this.prisma.fileIssueTransaction.updateMany({
      where: { status: "ISSUED", dueDate: { lt: new Date() } },
      data: { status: "OVERDUE" },
    });
    return result.count;
  }

  /** Spec §31: "one day before due date" reminder. Windowed rather than an
   * exact-date match so a job that runs more than once a day (or catches up
   * after downtime) doesn't miss the reminder - the tradeoff is a transaction
   * could get more than one reminder if this runs more than once within the
   * window; acceptable for a reminder (unlike overdue detection, this isn't
   * a state transition, just a notification), and simpler than tracking
   * "already reminded" state on the transaction. */
  async notifyDueTomorrow(): Promise<number> {
    const windowStart = new Date();
    const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dueTomorrow = await this.prisma.fileIssueTransaction.findMany({
      where: { status: "ISSUED", dueDate: { gte: windowStart, lte: windowEnd } },
      include: transactionInclude,
    });
    for (const transaction of dueTomorrow) {
      await this.notifications.notify(NOTIFICATION_EVENTS.FILE_DUE_TOMORROW, transaction.requesterId, {
        fileCode: transaction.physicalFile.fileCode,
        dueDate: transaction.dueDate?.toLocaleDateString() ?? "",
      });
    }
    return dueTomorrow.length;
  }
}
