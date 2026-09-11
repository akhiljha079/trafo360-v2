import { Body, Controller, Delete, Param, Patch } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { UpsertRequirementDto } from "./dto/workflow.dto";
import { WorkflowService } from "./workflow.service";

@Controller("document-requirements")
@Auth("workflow.edit")
export class DocumentRequirementsController {
  constructor(private readonly workflow: WorkflowService) {}

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: Partial<UpsertRequirementDto>,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.workflow.updateRequirement(id, dto, userId, ip);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.workflow.deleteRequirement(id, userId, ip);
  }
}
