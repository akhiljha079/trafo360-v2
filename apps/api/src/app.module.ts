import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ApprovalWorkflowsModule } from "./approval-workflows/approval-workflows.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { ConfidentialityModule } from "./confidentiality/confidentiality.module";
import { CustomersModule } from "./customers/customers.module";
import { DashboardsModule } from "./dashboards/dashboards.module";
import { DepartmentsModule } from "./departments/departments.module";
import { DocumentRequestsModule } from "./document-requests/document-requests.module";
import { DocumentTypesModule } from "./document-types/document-types.module";
import { DocumentsModule } from "./documents/documents.module";
import { EmailModule } from "./email/email.module";
import { FileIssuesModule } from "./file-issues/file-issues.module";
import { HealthController } from "./health/health.controller";
import { LdapModule } from "./ldap/ldap.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PhysicalFilesModule } from "./physical-files/physical-files.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReportsModule } from "./reports/reports.module";
import { RolesModule } from "./roles/roles.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { StorageModule } from "./storage/storage.module";
import { TypeTestCertificatesModule } from "./type-test-certificates/type-test-certificates.module";
import { UsersModule } from "./users/users.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { WorkflowModule } from "./workflow/workflow.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limit (spec §46 abuse-prevention ask) - a generous default
    // for normal API traffic; the login endpoint gets a much tighter
    // per-route limit (see AuthController) since that's the actual
    // brute-force target, not general API usage.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
    PrismaModule,
    SettingsModule,
    CommonModule,
    StorageModule,
    LdapModule,
    AuthModule,
    UsersModule,
    RolesModule,
    DepartmentsModule,
    AuditModule,
    ConfidentialityModule,
    CustomersModule,
    DocumentTypesModule,
    ApprovalWorkflowsModule,
    WorkflowModule,
    ProjectsModule,
    DocumentRequestsModule,
    EmailModule,
    WhatsappModule,
    NotificationsModule,
    DocumentsModule,
    PhysicalFilesModule,
    FileIssuesModule,
    DashboardsModule,
    SearchModule,
    ReportsModule,
    TypeTestCertificatesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
