import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { InternalTokenGuard } from "../common/internal-token.guard";
import { CreateCertificateDto, RenewCertificateDto, UpdateCertificateDto } from "./dto/certificate.dto";
import { TypeTestCertificatesService } from "./type-test-certificates.service";

@Controller("type-test-certificates")
export class TypeTestCertificatesController {
  constructor(private readonly certificates: TypeTestCertificatesService) {}

  @Get()
  @Auth("certificate.view")
  list() {
    return this.certificates.list();
  }

  @Get(":id")
  @Auth("certificate.view")
  get(@Param("id") id: string) {
    return this.certificates.get(id);
  }

  @Post()
  @Auth("certificate.manage")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  create(
    @Body() dto: CreateCertificateDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.certificates.create(dto, file, userId, ip);
  }

  @Patch(":id")
  @Auth("certificate.manage")
  update(@Param("id") id: string, @Body() dto: UpdateCertificateDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.certificates.update(id, dto, userId, ip);
  }

  @Delete(":id")
  @HttpCode(200)
  @Auth("certificate.manage")
  async remove(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    await this.certificates.delete(id, userId, ip);
    return { ok: true };
  }

  @Post(":id/renew")
  @Auth("certificate.manage")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  renew(
    @Param("id") id: string,
    @Body() dto: RenewCertificateDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.certificates.renew(id, dto, file, userId, ip);
  }

  @Get(":id/download")
  @Auth("certificate.view")
  async download(@Param("id") id: string, @CurrentUserId() userId: string, @Res() res: Response, @ClientIp() ip?: string) {
    const { buffer, fileName, mimeType } = await this.certificates.prepareDownload(id, userId, ip);
    res.set({
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  }

  /** Called by the worker process on a schedule (INTERNAL_WORKER_TOKEN, not
   * a user session - the worker has no logged-in user). Also safe to call
   * manually for a "check right now" - same idea as FileIssuesController's
   * check-overdue/check-due-tomorrow, except this one doesn't need a human
   * to remember to click it since the worker drives it automatically. */
  @Post("check-expiring")
  @UseGuards(InternalTokenGuard)
  checkExpiring() {
    return this.certificates.checkExpiring().then((notified) => ({ notified }));
  }
}
