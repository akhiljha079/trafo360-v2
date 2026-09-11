import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { DepartmentsService } from "./departments.service";
import { UpsertDepartmentDto } from "./dto/upsert-department.dto";

@Controller("departments")
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @Auth()
  list() {
    return this.departments.list();
  }

  @Post()
  @Auth("department.manage")
  create(@Body() dto: UpsertDepartmentDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.departments.create(dto, userId, ip);
  }

  @Patch(":id")
  @Auth("department.manage")
  update(
    @Param("id") id: string,
    @Body() dto: UpsertDepartmentDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.departments.update(id, dto, userId, ip);
  }
}
