import { Module } from "@nestjs/common";
import { ApprovalWorkflowsController } from "./approval-workflows.controller";

@Module({
  controllers: [ApprovalWorkflowsController],
})
export class ApprovalWorkflowsModule {}
