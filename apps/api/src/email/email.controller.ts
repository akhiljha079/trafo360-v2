import { Body, Controller, Get, Post, Put, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { AuditService } from "../common/audit.service";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { SendTestEmailDto, UpdateSmtpConfigDto } from "./dto/smtp-config.dto";
import { EmailService } from "./email.service";

@Controller("admin/smtp-config")
@Auth("notification.manage")
export class SmtpConfigController {
  constructor(
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  getConfig() {
    return this.email.getConfig();
  }

  @Put()
  async updateConfig(@Body() dto: UpdateSmtpConfigDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const config = await this.email.updateConfig(dto);
    await this.audit.log({
      userId,
      action: "SMTP_CONFIG_UPDATED",
      objectType: "SystemSetting",
      objectId: "smtp-config",
      newValue: { ...dto, password: dto.password ? "[redacted]" : undefined },
      ipAddress: ip,
    });
    return config;
  }

  @Post("test-email")
  sendTest(@Body() dto: SendTestEmailDto) {
    return this.email.sendTest(dto);
  }
}

@Controller("email-logs")
@Auth("notification.manage")
export class EmailLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query("status") status: string | undefined) {
    return this.prisma.emailLog.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
}
