import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import {
  ExtensionRequestsController,
  FileIssuesController,
  PhysicalFileIssueRequestsController,
} from "./file-issues.controller";
import { FileIssuesService } from "./file-issues.service";

@Module({
  imports: [NotificationsModule],
  controllers: [PhysicalFileIssueRequestsController, FileIssuesController, ExtensionRequestsController],
  providers: [FileIssuesService],
  exports: [FileIssuesService],
})
export class FileIssuesModule {}
