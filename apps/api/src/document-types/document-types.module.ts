import { Module } from "@nestjs/common";
import { DocumentTypesController } from "./document-types.controller";

@Module({
  controllers: [DocumentTypesController],
})
export class DocumentTypesModule {}
