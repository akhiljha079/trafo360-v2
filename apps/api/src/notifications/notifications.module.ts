import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { NotificationRulesController, NotificationTemplatesController } from "./notification-templates.controller";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [EmailModule, WhatsappModule],
  controllers: [NotificationTemplatesController, NotificationRulesController, NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
