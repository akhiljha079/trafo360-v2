import { Body, Controller, Delete, Param, Patch, Post } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { ReorderDto, UpsertParentStageDto, UpsertStageDto } from "./dto/workflow.dto";
import { WorkflowService } from "./workflow.service";

@Controller("parent-stages")
@Auth("workflow.edit")
export class ParentStagesController {
  constructor(private readonly workflow: WorkflowService) {}

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpsertParentStageDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.updateParentStage(id, dto, userId, ip);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.deleteParentStage(id, userId, ip);
  }

  @Post(":id/stages")
  createStage(@Param("id") id: string, @Body() dto: UpsertStageDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.createStage(id, dto, userId, ip);
  }

  @Patch(":id/stages/reorder")
  reorderStages(@Param("id") id: string, @Body() dto: ReorderDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.reorderStages(id, dto, userId, ip);
  }
}
