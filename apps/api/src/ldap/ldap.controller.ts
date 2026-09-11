import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { UpdateAdConfigDto } from "./dto/update-ad-config.dto";
import { LdapService } from "./ldap.service";

@Controller("admin/ad-config")
@Auth("ad.manage")
export class LdapController {
  constructor(private readonly ldap: LdapService) {}

  @Get()
  getConfig() {
    return this.ldap.getConfig();
  }

  @Put()
  updateConfig(@Body() dto: UpdateAdConfigDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.ldap.updateConfig(dto, userId, ip);
  }

  @Post("test-connection")
  testConnection() {
    return this.ldap.testConnection();
  }

  @Post("sync-now")
  syncNow(@CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.ldap.syncNow(userId, ip);
  }
}
