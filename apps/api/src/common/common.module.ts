import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { InternalTokenGuard } from "./internal-token.guard";
import { PermissionsGuard } from "./permissions.guard";
import { PermissionsService } from "./permissions.service";

@Global()
@Module({
  providers: [PermissionsService, PermissionsGuard, AuditService, InternalTokenGuard],
  exports: [PermissionsService, PermissionsGuard, AuditService, InternalTokenGuard],
})
export class CommonModule {}
