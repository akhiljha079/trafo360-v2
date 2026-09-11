import { Global, Module } from "@nestjs/common";
import { StorageConfigController, StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";

@Global()
@Module({
  controllers: [StorageController, StorageConfigController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
