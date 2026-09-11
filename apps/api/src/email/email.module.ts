import { Module } from "@nestjs/common";
import { EmailLogsController, SmtpConfigController } from "./email.controller";
import { EmailService } from "./email.service";

@Module({
  controllers: [SmtpConfigController, EmailLogsController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
