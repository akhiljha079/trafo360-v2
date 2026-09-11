import { Module } from "@nestjs/common";
import { WorkflowModule } from "../workflow/workflow.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [WorkflowModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
