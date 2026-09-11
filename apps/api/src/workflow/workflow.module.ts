import { Module } from "@nestjs/common";
import { DocumentRequirementsController } from "./document-requirements.controller";
import { ParentStagesController } from "./parent-stages.controller";
import { ProjectDocumentRequirementsController, ProjectWorkflowController } from "./project-workflow.controller";
import { StagesController } from "./stages.controller";
import { WorkflowService } from "./workflow.service";
import { WorkflowTemplatesController } from "./workflow-templates.controller";

@Module({
  controllers: [
    WorkflowTemplatesController,
    ParentStagesController,
    StagesController,
    DocumentRequirementsController,
    ProjectWorkflowController,
    ProjectDocumentRequirementsController,
  ],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
