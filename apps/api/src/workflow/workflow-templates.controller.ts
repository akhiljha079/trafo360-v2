import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { CloneWorkflowTemplateDto, UpsertParentStageDto, UpsertWorkflowTemplateDto, ReorderDto } from "./dto/workflow.dto";
import { WorkflowService } from "./workflow.service";

@Controller("workflow-templates")
export class WorkflowTemplatesController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get()
  @Auth()
  list() {
    return this.workflow.listTemplates();
  }

  @Get(":id")
  @Auth()
  get(@Param("id") id: string) {
    return this.workflow.getTemplate(id);
  }

  @Post()
  @Auth("workflow.create")
  create(@Body() dto: UpsertWorkflowTemplateDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.createTemplate(dto, userId, ip);
  }

  @Patch(":id")
  @Auth("workflow.edit")
  update(@Param("id") id: string, @Body() dto: UpsertWorkflowTemplateDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.updateTemplate(id, dto, userId, ip);
  }

  @Post(":id/clone")
  @Auth("workflow.create")
  clone(@Param("id") id: string, @Body() dto: CloneWorkflowTemplateDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.clone(id, dto, userId, ip);
  }

  @Post(":id/activate")
  @Auth("workflow.publish")
  activate(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.setActive(id, true, userId, ip);
  }

  @Post(":id/deactivate")
  @Auth("workflow.publish")
  deactivate(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.setActive(id, false, userId, ip);
  }

  @Post(":id/parent-stages")
  @Auth("workflow.edit")
  createParentStage(
    @Param("id") id: string,
    @Body() dto: UpsertParentStageDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.workflow.createParentStage(id, dto, userId, ip);
  }

  @Patch(":id/parent-stages/reorder")
  @Auth("workflow.edit")
  reorderParentStages(@Param("id") id: string, @Body() dto: ReorderDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.reorderParentStages(id, dto, userId, ip);
  }
}
