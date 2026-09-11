import { Module } from "@nestjs/common";
import { PhysicalFileResolverController, PhysicalFilesController } from "./physical-files.controller";
import { PhysicalFilesService } from "./physical-files.service";

@Module({
  controllers: [PhysicalFilesController, PhysicalFileResolverController],
  providers: [PhysicalFilesService],
  exports: [PhysicalFilesService],
})
export class PhysicalFilesModule {}
