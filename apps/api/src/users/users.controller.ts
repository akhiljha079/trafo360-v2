import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { CreateUserDto } from "./dto/create-user.dto";
import { SetPermissionOverridesDto } from "./dto/set-permission-overrides.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ListUsersQuery, UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Auth("user.manage")
  list(@Query() query: ListUsersQuery) {
    return this.users.list({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get(":id")
  @Auth("user.manage")
  get(@Param("id") id: string) {
    return this.users.get(id);
  }

  @Post()
  @Auth("user.manage")
  create(@Body() dto: CreateUserDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.users.create(dto, userId, ip);
  }

  @Patch(":id")
  @Auth("user.manage")
  update(@Param("id") id: string, @Body() dto: UpdateUserDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.users.update(id, dto, userId, ip);
  }

  @Get(":id/login-history")
  @Auth("user.manage")
  loginHistory(@Param("id") id: string) {
    return this.users.getLoginHistory(id);
  }

  @Put(":id/permission-overrides")
  @Auth("user.manage")
  setOverrides(
    @Param("id") id: string,
    @Body() dto: SetPermissionOverridesDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.users.setPermissionOverrides(id, dto, userId, ip);
  }
}
