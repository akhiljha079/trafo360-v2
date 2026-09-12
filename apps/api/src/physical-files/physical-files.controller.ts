import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { UpsertPhysicalFileLocationDto } from "./dto/physical-file.dto";
import { PhysicalFilesService } from "./physical-files.service";

@Controller("physical-files")
export class PhysicalFilesController {
  constructor(private readonly physicalFiles: PhysicalFilesService) {}

  @Get()
  @Auth("physical_file.view")
  list(@Query("search") search: string | undefined, @CurrentUserId() userId: string) {
    return this.physicalFiles.list(userId, search);
  }

  @Get(":id")
  @Auth("physical_file.view")
  get(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.physicalFiles.get(id, userId);
  }

  @Get(":id/qr-code")
  @Auth("physical_file.view")
  qrCode(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.physicalFiles.getQrCodeDataUrl(id, userId).then((dataUrl) => ({ dataUrl }));
  }

  @Get(":id/label")
  @Auth("physical_file.view")
  label(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.physicalFiles.getLabelData(id, userId);
  }

  @Get("projects/:projectId")
  @Auth("physical_file.view")
  getByProject(@Param("projectId") projectId: string, @CurrentUserId() userId: string) {
    return this.physicalFiles.getByProject(projectId, userId);
  }

  @Post("projects/:projectId")
  @Auth("physical_file.create")
  create(@Param("projectId") projectId: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.physicalFiles.createForProject(projectId, userId, ip);
  }

  @Delete(":id")
  @HttpCode(200)
  @Auth("physical_file.create")
  async remove(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    await this.physicalFiles.delete(id, userId, ip);
    return { ok: true };
  }

  @Patch(":id/location")
  @Auth("physical_file.create")
  updateLocation(
    @Param("id") id: string,
    @Body() dto: UpsertPhysicalFileLocationDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.physicalFiles.updateLocation(id, dto, userId, ip);
  }
}

/** QR resolver - spec §26: "scanning the QR should open the project file
 * page after authentication." Auth-gated like everything else; the QR
 * itself only ever contains this opaque-token URL. */
@Controller("pf")
export class PhysicalFileResolverController {
  constructor(private readonly physicalFiles: PhysicalFilesService) {}

  @Get(":token")
  @Auth("physical_file.view")
  resolve(@Param("token") token: string, @CurrentUserId() userId: string) {
    return this.physicalFiles.getByToken(token, userId);
  }
}
