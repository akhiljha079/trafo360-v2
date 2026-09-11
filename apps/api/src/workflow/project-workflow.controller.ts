import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { OverrideProjectRequirementDto } from "./dto/workflow.dto";
import { WorkflowService } from "./workflow.service";

@Controller("projects/:projectId/workflow")
export class ProjectWorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get()
  @Auth("project.view")
  get(@Param("projectId") projectId: string) {
    return this.workflow.getProjectWorkflow(projectId);
  }

  @Post("instantiate")
  @Auth("project.edit")
  instantiate(@Param("projectId") projectId: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.instantiateForProject(projectId, userId, ip);
  }
}

@Controller("project-document-requirements")
export class ProjectDocumentRequirementsController {
  constructor(private readonly workflow: WorkflowService) {}

  @Patch(":id/override")
  @Auth("project.edit")
  override(
    @Param("id") id: string,
    @Body() dto: OverrideProjectRequirementDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.workflow.overrideProjectRequirement(id, dto, userId, ip);
  }
}
