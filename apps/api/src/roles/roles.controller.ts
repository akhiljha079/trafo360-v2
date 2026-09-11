import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { SetRolePermissionsDto } from "./dto/set-role-permissions.dto";
import { UpsertRoleDto } from "./dto/upsert-role.dto";
import { RolesService } from "./roles.service";

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get("permissions")
  @Auth("role.manage")
  listPermissions() {
    return this.roles.listPermissions();
  }

  @Get("roles")
  @Auth("role.manage")
  list() {
    return this.roles.list();
  }

  @Get("roles/:id")
  @Auth("role.manage")
  get(@Param("id") id: string) {
    return this.roles.get(id);
  }

  @Post("roles")
  @Auth("role.manage")
  create(@Body() dto: UpsertRoleDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.roles.create(dto, userId, ip);
  }

  @Patch("roles/:id")
  @Auth("role.manage")
  update(@Param("id") id: string, @Body() dto: UpsertRoleDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.roles.update(id, dto, userId, ip);
  }

  @Put("roles/:id/permissions")
  @Auth("role.manage")
  setPermissions(
    @Param("id") id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.roles.setPermissions(id, dto, userId, ip);
  }
}
