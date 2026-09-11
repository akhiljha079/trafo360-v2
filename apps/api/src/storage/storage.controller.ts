import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { AuditService } from "../common/audit.service";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateStorageConfigDto } from "./dto/update-storage-config.dto";
import { StorageService } from "./storage.service";

@Controller("admin/storage-config")
@Auth("storage.manage")
export class StorageConfigController {
  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  getConfig() {
    return this.storage.getConfig();
  }

  @Put()
  async updateConfig(@Body() dto: UpdateStorageConfigDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    const config = await this.storage.updateConfig(dto);
    await this.audit.log({
      userId,
      action: "STORAGE_CONFIG_UPDATED",
      objectType: "SystemSetting",
      objectId: "storage-config",
      newValue: dto,
      ipAddress: ip,
    });
    return config;
  }

  /** Probes the *currently saved* config, not unsaved form values - save
   * first, then test, same as AD's test-connection. */
  @Post("test-connection")
  async testConnection() {
    const healthy = await this.storage.isNfsHealthy();
    const { nfsEnabled, nfsMountPath } = await this.storage.getConfig();
    if (!nfsEnabled) {
      return { success: false, message: "NFS is disabled - uploads will always use local storage." };
    }
    return healthy
      ? { success: true, message: `NFS is reachable at ${nfsMountPath}.` }
      : {
          success: false,
          message: `Could not write to ${nfsMountPath} - check that the Synology export is actually mounted there (mount -t nfs ... or /etc/fstab) and that this server's IP is allowed in the export's NFS permissions.`,
        };
  }
}

@Controller("storage/health")
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Auth("storage.manage")
  async health() {
    const [nfsOnline, totalDocuments, nfsDocuments, localPendingDocuments, syncFailedDocuments, sizeAgg, lastSuccess, lastFailure] =
      await Promise.all([
        this.storage.isNfsHealthy(),
        this.prisma.documentVersion.count(),
        this.prisma.documentVersion.count({ where: { storageStatus: { in: ["NFS_STORED", "SYNCED"] } } }),
        this.prisma.documentVersion.count({ where: { storageStatus: "LOCAL_PENDING_SYNC" } }),
        this.prisma.documentVersion.count({ where: { storageStatus: "SYNC_FAILED" } }),
        this.prisma.documentVersion.aggregate({ _sum: { sizeBytes: true } }),
        this.prisma.storageSyncJob.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { updatedAt: "desc" } }),
        this.prisma.storageSyncJob.findFirst({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" } }),
      ]);

    return {
      nfsOnline,
      totalDocuments,
      nfsDocuments,
      localPendingDocuments,
      syncFailedDocuments,
      storageUsedBytes: (sizeAgg._sum.sizeBytes ?? 0n).toString(),
      lastSuccessfulSyncAt: lastSuccess?.updatedAt ?? null,
      lastFailedSyncAt: lastFailure?.updatedAt ?? null,
    };
  }
}
