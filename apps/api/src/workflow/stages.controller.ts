import { Body, Controller, Delete, Param, Patch, Post } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { UpsertRequirementDto, UpsertStageDto } from "./dto/workflow.dto";
import { WorkflowService } from "./workflow.service";

@Controller("stages")
@Auth("workflow.edit")
export class StagesController {
  constructor(private readonly workflow: WorkflowService) {}

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpsertStageDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.updateStage(id, dto, userId, ip);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.deleteStage(id, userId, ip);
  }

  @Post(":id/document-requirements")
  createRequirement(
    @Param("id") id: string,
    @Body() dto: UpsertRequirementDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.workflow.createRequirement(id, dto, userId, ip);
  }
}
