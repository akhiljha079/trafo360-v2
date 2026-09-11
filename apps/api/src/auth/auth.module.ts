import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { LdapModule } from "../ldap/ldap.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Global()
@Module({
  imports: [JwtModule.register({ global: true }), LdapModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
