import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
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
}
