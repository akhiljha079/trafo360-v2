import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { AuditService } from "../common/audit.service";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertDocumentTypeDto } from "./dto/upsert-document-type.dto";

@Controller("document-types")
export class DocumentTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Auth()
  list() {
    return this.prisma.documentType.findMany({
      include: { confidentialityLevel: true },
      orderBy: { name: "asc" },
    });
  }

  @Post()
  @Auth("document_type.manage")
  async create(@Body() dto: UpsertDocumentTypeDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const existing = await this.prisma.documentType.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException("A document type with that code already exists");
    const documentType = await this.prisma.documentType.create({ data: dto });
    await this.audit.log({
      userId,
      action: "DOCUMENT_TYPE_CREATED",
      objectType: "DocumentType",
      objectId: documentType.id,
      newValue: dto,
      ipAddress: ip,
    });
    return documentType;
  }

  @Patch(":id")
  @Auth("document_type.manage")
  async update(
    @Param("id") id: string,
    @Body() dto: UpsertDocumentTypeDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    const before = await this.prisma.documentType.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Document type not found");
    const documentType = await this.prisma.documentType.update({ where: { id }, data: dto });
    await this.audit.log({
      userId,
      action: "DOCUMENT_TYPE_UPDATED",
      objectType: "DocumentType",
      objectId: id,
      oldValue: before,
      newValue: dto,
      ipAddress: ip,
    });
    return documentType;
  }

  /** Same FK-safety-net pattern used for project/customer/document deletion:
   * StageDocumentRequirement.documentTypeId and Document.documentTypeId both
   * reference this without ON DELETE CASCADE, so a type still used by a
   * workflow stage or an actual uploaded document refuses to delete rather
   * than silently orphaning either. */
  @Delete(":id")
  @HttpCode(200)
  @Auth("document_type.manage")
  async remove(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const documentType = await this.prisma.documentType.findUnique({ where: { id } });
    if (!documentType) throw new NotFoundException("Document type not found");

    try {
      await this.prisma.documentType.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
        throw new ConflictException(
          "This document type is still used by a workflow stage or an uploaded document - remove those references first.",
        );
      }
      throw err;
    }

    await this.audit.log({
      userId,
      action: "DOCUMENT_TYPE_DELETED",
      objectType: "DocumentType",
      objectId: id,
      oldValue: { code: documentType.code, name: documentType.name },
      ipAddress: ip,
    });
    return { ok: true };
  }
}
