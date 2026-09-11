import { Controller, Get, Post } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { AuditService } from "../common/audit.service";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { WhatsappService } from "./whatsapp.service";

/** Admin-only, on purpose (spec §35 - "do not expose QR/session data to
 * normal users"). Nothing here is ever reachable without `notification.manage`. */
@Controller("admin/whatsapp")
@Auth("notification.manage")
export class WhatsappController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly audit: AuditService,
  ) {}

  @Get("status")
  status() {
    return this.whatsapp.status();
  }

  @Post("connect")
  async connect(@CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const result = await this.whatsapp.connect();
    await this.audit.log({ userId, action: "WHATSAPP_CONNECT_INITIATED", objectType: "WhatsappSession", ipAddress: ip });
    return result;
  }

  @Post("disconnect")
  async disconnect(@CurrentUserId() userId: string, @ClientIp() ip?: string) {
    await this.whatsapp.disconnect();
    await this.audit.log({ userId, action: "WHATSAPP_DISCONNECTED", objectType: "WhatsappSession", ipAddress: ip });
    return { ok: true };
  }
}
