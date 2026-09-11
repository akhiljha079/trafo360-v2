import { Injectable, Logger } from "@nestjs/common";
import { NotificationEventKey } from "@trafo360/shared";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappService } from "../whatsapp/whatsapp.service";

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");
}

/** Single entry point for every notification in the app (spec §34/§60) -
 * nothing sends email/WhatsApp/in-app notifications directly, everything
 * calls notify(). That's what makes NotificationRule's per-event channel
 * toggles actually mean something: flip a switch in the admin UI and every
 * call site respects it without code changes. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async notify(eventKey: NotificationEventKey, userId: string, variables: Record<string, string>): Promise<void> {
    const [rule, user] = await Promise.all([
      this.prisma.notificationRule.findUnique({ where: { eventKey } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!user) {
      this.logger.warn(`notify() called for unknown user ${userId} (event ${eventKey})`);
      return;
    }

    // No rule row = sensible defaults (email + in-app on, WhatsApp off -
    // matches spec §35's "email is authoritative" stance).
    const emailEnabled = rule?.emailEnabled ?? true;
    const whatsappEnabled = rule?.whatsappEnabled ?? false;
    const inAppEnabled = rule?.inAppEnabled ?? true;

    const templates = await this.prisma.notificationTemplate.findMany({
      where: { eventKey, active: true },
    });
    const byChannel = new Map(templates.map((t) => [t.channel, t]));

    if (emailEnabled && user.email) {
      const template = byChannel.get("EMAIL");
      const subject = template?.subject ? renderTemplate(template.subject, variables) : eventKey.replace(/_/g, " ");
      const body = template?.body
        ? renderTemplate(template.body, variables)
        : `<p>${Object.entries(variables)
            .map(([k, v]) => `${k}: ${v}`)
            .join("<br/>")}</p>`;
      await this.email.send(user.email, subject, body, eventKey);
    }

    if (whatsappEnabled && user.mobile) {
      const template = byChannel.get("WHATSAPP");
      const body = template?.body
        ? renderTemplate(template.body, variables)
        : `${eventKey.replace(/_/g, " ")}: ${Object.values(variables).join(", ")}`;
      await this.whatsapp.send(user.mobile, body, eventKey);
    }

    if (inAppEnabled) {
      const template = byChannel.get("INAPP");
      const title = template?.subject ? renderTemplate(template.subject, variables) : eventKey.replace(/_/g, " ");
      const body = template?.body
        ? renderTemplate(template.body, variables)
        : Object.entries(variables)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
      await this.prisma.notification.create({ data: { userId, title, body, eventKey } });
    }
  }

  async listForUser(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
