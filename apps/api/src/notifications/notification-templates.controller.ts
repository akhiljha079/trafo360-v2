import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { NOTIFICATION_EVENT_KEYS } from "@trafo360/shared";
import { Auth } from "../common/auth.decorator";
import { AuditService } from "../common/audit.service";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertNotificationRuleDto, UpsertNotificationTemplateDto } from "./dto/notification.dto";

@Controller("notification-templates")
@Auth("notification.manage")
export class NotificationTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("event-keys")
  eventKeys() {
    return NOTIFICATION_EVENT_KEYS;
  }

  @Get()
  list() {
    return this.prisma.notificationTemplate.findMany({ orderBy: [{ eventKey: "asc" }, { channel: "asc" }] });
  }

  @Post()
  async upsert(@Body() dto: UpsertNotificationTemplateDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const template = await this.prisma.notificationTemplate.upsert({
      where: { eventKey_channel: { eventKey: dto.eventKey, channel: dto.channel } },
      update: { subject: dto.subject, body: dto.body, active: dto.active ?? true },
      create: { eventKey: dto.eventKey, channel: dto.channel, subject: dto.subject, body: dto.body, active: dto.active ?? true },
    });
    await this.audit.log({
      userId,
      action: "NOTIFICATION_TEMPLATE_SAVED",
      objectType: "NotificationTemplate",
      objectId: template.id,
      newValue: dto,
      ipAddress: ip,
    });
    return template;
  }
}

@Controller("notification-rules")
@Auth("notification.manage")
export class NotificationRulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.notificationRule.findMany({ orderBy: { eventKey: "asc" } });
  }

  @Put()
  async upsert(@Body() dto: UpsertNotificationRuleDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const rule = await this.prisma.notificationRule.upsert({
      where: { eventKey: dto.eventKey },
      update: dto,
      create: dto,
    });
    await this.audit.log({
      userId,
      action: "NOTIFICATION_RULE_SAVED",
      objectType: "NotificationRule",
      objectId: rule.id,
      newValue: dto,
      ipAddress: ip,
    });
    return rule;
  }
}
