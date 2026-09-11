import { Module } from "@nestjs/common";
import { DocumentRequestsController } from "./document-requests.controller";
import { DocumentRequestsService } from "./document-requests.service";

@Module({
  controllers: [DocumentRequestsController],
  providers: [DocumentRequestsService],
  exports: [DocumentRequestsService],
})
export class DocumentRequestsModule {}
