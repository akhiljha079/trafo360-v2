import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { DecideApprovalDto } from "./dto/decide-approval.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { DocumentsService } from "./documents.service";

@Controller("projects/:projectId/documents")
export class ProjectDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Auth("document.view")
  list(@Param("projectId") projectId: string, @CurrentUserId() userId: string) {
    return this.documents.listForProject(projectId, userId);
  }

  @Post()
  @Auth("document.upload")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }))
  upload(
    @Param("projectId") projectId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.documents.upload(projectId, dto, file, userId, ip);
  }
}

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Auth("document.view")
  listAll(@Query("search") search: string | undefined, @CurrentUserId() userId: string) {
    return this.documents.listAll(userId, search);
  }

  @Get(":id")
  @Auth("document.view")
  get(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.documents.get(id, userId);
  }

  @Patch(":id")
  @Auth("document.edit")
  update(@Param("id") id: string, @Body() dto: UpdateDocumentDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.documents.updateMetadata(id, dto, userId, ip);
  }

  @Delete(":id")
  @HttpCode(200)
  @Auth("document.delete")
  async remove(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    await this.documents.delete(id, userId, ip);
    return { ok: true };
  }

  @Post(":documentId/versions")
  @Auth("document.version")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }))
  uploadNewVersion(
    @Param("documentId") documentId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    // projectId is redundant with documentId but upload() needs it for
    // storage pathing; look it up rather than trusting the client.
    return this.documents.uploadVersionForExistingDocument(documentId, dto, file, userId, ip);
  }

  /** Same auth/confidentiality/audit path as a real download - `?inline=1`
   * only changes Content-Disposition so the browser renders the file (PDF/
   * image) in place instead of triggering a save dialog, and tags the
   * audit log entry as a preview rather than a download. Never trust the
   * client to say what's previewable - that's a frontend-only choice
   * (which mime types get a View button at all); the server will happily
   * stream anything inline if asked, same as it always could via download. */
  @Get("versions/:versionId/download")
  @Auth("document.download")
  async download(
    @Param("versionId") versionId: string,
    @Query("inline") inline: string | undefined,
    @CurrentUserId() userId: string,
    @Res() res: Response,
    @ClientIp() ip?: string,
  ) {
    const isPreview = inline === "1";
    const { buffer, fileName, mimeType } = await this.documents.prepareDownload(versionId, userId, ip, isPreview);
    res.set({
      "Content-Type": mimeType,
      "Content-Disposition": `${isPreview ? "inline" : "attachment"}; filename="${encodeURIComponent(fileName)}"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  }
}

@Controller("document-approvals")
export class DocumentApprovalsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get("pending")
  @Auth("document.approve")
  pending(@CurrentUserId() userId: string) {
    return this.documents.listPendingApprovalsForUser(userId);
  }

  @Post(":id/approve")
  @Auth("document.approve")
  approve(@Param("id") id: string, @Body() dto: DecideApprovalDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.documents.approve(id, dto, userId, ip);
  }

  @Post(":id/reject")
  @Auth("document.reject")
  reject(@Param("id") id: string, @Body() dto: DecideApprovalDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.documents.reject(id, dto, userId, ip);
  }
}
