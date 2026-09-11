import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { TypeTestCertificatesController } from "./type-test-certificates.controller";
import { TypeTestCertificatesService } from "./type-test-certificates.service";

@Module({
  imports: [NotificationsModule],
  controllers: [TypeTestCertificatesController],
  providers: [TypeTestCertificatesService],
})
export class TypeTestCertificatesModule {}
