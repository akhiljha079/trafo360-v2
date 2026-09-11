import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateDocumentRequestDto } from "./dto/create-document-request.dto";

const requestInclude = {
  requester: { select: { id: true, name: true } },
  document: { select: { id: true, title: true, confidentialityLevelId: true } },
} as const;

/** Spec §28/§29 - digital document requests for confidentiality-gated
 * downloads. Physical file requests have their own flow (FileIssuesService)
 * since they involve a location and a return, not just a decision; this
 * module is deliberately the simpler "just needs a yes/no" case. Single-
 * step approval for now (spec allows a configurable multi-step chain per
 * confidentiality/department/role - deferred, same reasoning as the
 * physical-file approval scoping: get the core gate working correctly
 * first, generalize the routing later if it turns out to be needed). */
@Injectable()
export class DocumentRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateDocumentRequestDto, userId: string, ip?: string) {
    const document = await this.prisma.document.findUnique({ where: { id: dto.documentId } });
    if (!document) throw new NotFoundException("Document not found");

    const request = await this.prisma.documentRequest.create({
      data: {
        requesterId: userId,
        documentId: dto.documentId,
        projectId: document.projectId,
        reason: dto.reason,
        purpose: dto.purpose,
        requiredUntil: dto.requiredUntil ? new Date(dto.requiredUntil) : undefined,
        mode: "DIGITAL",
        status: "REQUESTED",
      },
      include: requestInclude,
    });
    await this.audit.log({
      userId,
      action: "DOCUMENT_REQUEST_CREATED",
      objectType: "DocumentRequest",
      objectId: request.id,
      newValue: dto,
      ipAddress: ip,
    });
    return request;
  }

  async list(filters: { status?: string; documentId?: string }) {
    return this.prisma.documentRequest.findMany({
      where: {
        mode: "DIGITAL",
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.documentId ? { documentId: filters.documentId } : {}),
      },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  async approve(id: string, userId: string, ip?: string) {
    const request = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException("Document request not found");
    if (request.status !== "REQUESTED") throw new BadRequestException("This request was already decided");

    const updated = await this.prisma.documentRequest.update({
      where: { id },
      data: { status: "APPROVED" },
      include: requestInclude,
    });
    await this.audit.log({ userId, action: "DOCUMENT_REQUEST_APPROVED", objectType: "DocumentRequest", objectId: id, ipAddress: ip });
    return updated;
  }

  async reject(id: string, userId: string, ip?: string) {
    const request = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException("Document request not found");
    if (request.status !== "REQUESTED") throw new BadRequestException("This request was already decided");

    const updated = await this.prisma.documentRequest.update({
      where: { id },
      data: { status: "REJECTED" },
      include: requestInclude,
    });
    await this.audit.log({ userId, action: "DOCUMENT_REQUEST_REJECTED", objectType: "DocumentRequest", objectId: id, ipAddress: ip });
    return updated;
  }

  /** Used by DocumentsService.prepareDownload to gate HIGHLY_CONFIDENTIAL/
   * RESTRICTED downloads beyond the confidentiality ceiling check (closes
   * the gap flagged in Phase 4's BUILD_PROGRESS.md notes). */
  async hasApprovedRequest(documentId: string, userId: string): Promise<boolean> {
    const request = await this.prisma.documentRequest.findFirst({
      where: {
        documentId,
        requesterId: userId,
        status: "APPROVED",
        OR: [{ requiredUntil: null }, { requiredUntil: { gte: new Date() } }],
      },
    });
    return !!request;
  }
}
