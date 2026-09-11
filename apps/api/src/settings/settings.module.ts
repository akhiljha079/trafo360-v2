import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "../common/encryption.service";
import { SettingsService } from "./settings.service";

@Global()
@Module({
  providers: [SettingsService, EncryptionService],
  exports: [SettingsService, EncryptionService],
})
export class SettingsModule {}
