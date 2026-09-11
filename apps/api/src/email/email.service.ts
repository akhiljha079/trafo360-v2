import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { SettingsService } from "../settings/settings.service";
import { PrismaService } from "../prisma/prisma.service";
import { SendTestEmailDto, UpdateSmtpConfigDto } from "./dto/smtp-config.dto";

const KEYS = {
  enabled: "smtp.enabled",
  host: "smtp.host",
  port: "smtp.port",
  secure: "smtp.secure",
  user: "smtp.user",
  password: "smtp.password",
  fromEmail: "smtp.fromEmail",
  fromName: "smtp.fromName",
} as const;

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordSet: boolean;
  fromEmail: string;
  fromName: string;
}

/** SMTP is the authoritative notification channel (spec §35 - WhatsApp is
 * supplementary, policy-fragile, and not to be relied on alone). Config
 * lives in SystemSetting like AD's does (LdapService), same encrypted-
 * password pattern. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async getConfig(): Promise<SmtpConfig> {
    const values = await this.settings.getMany(Object.values(KEYS));
    return {
      enabled: values[KEYS.enabled] === "true",
      host: values[KEYS.host] ?? "",
      port: Number(values[KEYS.port] ?? 587),
      secure: values[KEYS.secure] === "true",
      user: values[KEYS.user] ?? "",
      passwordSet: !!values[KEYS.password],
      fromEmail: values[KEYS.fromEmail] ?? "",
      fromName: values[KEYS.fromName] ?? "TRAFO 360",
    };
  }

  async updateConfig(dto: UpdateSmtpConfigDto): Promise<SmtpConfig> {
    await this.settings.setMany([
      { key: KEYS.enabled, value: String(dto.enabled) },
      { key: KEYS.host, value: dto.host },
      { key: KEYS.port, value: String(dto.port) },
      { key: KEYS.secure, value: String(dto.secure) },
      { key: KEYS.user, value: dto.user ?? "" },
      { key: KEYS.password, value: dto.password, isSecret: true },
      { key: KEYS.fromEmail, value: dto.fromEmail },
      { key: KEYS.fromName, value: dto.fromName },
    ]);
    return this.getConfig();
  }

  private async buildTransport() {
    const values = await this.settings.getMany(Object.values(KEYS));
    if (!values[KEYS.host]) throw new Error("SMTP is not configured");
    return nodemailer.createTransport({
      host: values[KEYS.host]!,
      port: Number(values[KEYS.port] ?? 587),
      secure: values[KEYS.secure] === "true",
      auth: values[KEYS.user] ? { user: values[KEYS.user]!, pass: values[KEYS.password] ?? "" } : undefined,
    });
  }

  /** Sends and logs to EmailLog regardless of outcome - the log is the
   * audit trail for "did this notification actually go out" (spec §34). */
  async send(toEmail: string, subject: string, html: string, eventKey?: string): Promise<boolean> {
    const config = await this.getConfig();
    try {
      const transport = await this.buildTransport();
      await transport.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: toEmail,
        subject,
        html,
      });
      await this.prisma.emailLog.create({ data: { toAddress: toEmail, subject, status: "SENT", eventKey } });
      return true;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Email send failed to ${toEmail}: ${message}`);
      await this.prisma.emailLog.create({ data: { toAddress: toEmail, subject, status: "FAILED", error: message, eventKey } });
      return false;
    }
  }

  async sendTest(dto: SendTestEmailDto): Promise<{ success: boolean; message: string }> {
    const sent = await this.send(
      dto.toEmail,
      "TRAFO 360 — Test Email",
      "<p>This is a test email from TRAFO 360's SMTP configuration. If you received this, your SMTP settings are working.</p>",
      "SMTP_TEST",
    );
    return sent
      ? { success: true, message: "Test email sent successfully" }
      : { success: false, message: "Failed to send - check the email log for the error" };
  }
}
