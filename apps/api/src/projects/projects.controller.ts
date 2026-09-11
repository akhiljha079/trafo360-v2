import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { AddProjectMemberDto } from "./dto/add-member.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ListProjectsQuery, ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @Auth("project.view")
  list(@Query() query: ListProjectsQuery, @CurrentUserId() userId: string) {
    return this.projects.list(
      { ...query, page: query.page ? Number(query.page) : undefined, pageSize: query.pageSize ? Number(query.pageSize) : undefined },
      userId,
    );
  }

  @Get(":id")
  @Auth("project.view")
  get(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.projects.get(id, userId);
  }

  @Post()
  @Auth("project.create")
  create(@Body() dto: CreateProjectDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.projects.create(dto, userId, ip);
  }

  @Patch(":id")
  @Auth("project.edit")
  update(@Param("id") id: string, @Body() dto: UpdateProjectDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.projects.update(id, dto, userId, ip);
  }

  @Post(":id/members")
  @Auth("project.edit")
  addMember(
    @Param("id") id: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.projects.addMember(id, dto, userId, ip);
  }

  @Delete(":id/members/:memberUserId")
  @Auth("project.edit")
  removeMember(
    @Param("id") id: string,
    @Param("memberUserId") memberUserId: string,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.projects.removeMember(id, memberUserId, userId, ip);
  }
}
