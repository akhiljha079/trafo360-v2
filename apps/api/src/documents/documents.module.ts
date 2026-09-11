import { Module } from "@nestjs/common";
import { DocumentRequestsModule } from "../document-requests/document-requests.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { DocumentApprovalsController, DocumentsController, ProjectDocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [WorkflowModule, DocumentRequestsModule, NotificationsModule],
  controllers: [ProjectDocumentsController, DocumentsController, DocumentApprovalsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
