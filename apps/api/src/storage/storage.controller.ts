import { Controller, Get } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "./storage.service";

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
