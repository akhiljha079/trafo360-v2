import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { checksumOf, isNfsHealthy, readLocalPending } from "@trafo360/shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SettingsService } from "../settings/settings.service";

export interface StorageWriteResult {
  storagePath: string; // relative path, stored in the DB - never a raw absolute path handed to a client
  storageStatus: "NFS_STORED" | "LOCAL_PENDING_SYNC";
  checksum: string;
  sizeBytes: number;
}

export interface StorageConfig {
  nfsEnabled: boolean;
  nfsHost: string;
  nfsExportPath: string;
  nfsMountPath: string;
}

const KEYS = {
  nfsEnabled: "storage.nfsEnabled",
  nfsHost: "storage.nfsHost",
  nfsExportPath: "storage.nfsExportPath",
  nfsMountPath: "storage.nfsMountPath",
} as const;

/** NFS + local-fallback storage (architecture plan §6, spec §36/§37). The
 * actual read/write/checksum/health-probe primitives live in
 * libs/shared/src/storage-primitives.ts so the worker's sync job (which is
 * a plain Node process, not a Nest app) can reuse them without duplicating
 * this logic - this class is a thin Nest-config-aware wrapper around them.
 *
 * Config is admin-editable (Administration -> Storage), same SystemSetting
 * pattern as AD/SMTP - looked up fresh on every call rather than cached at
 * construction, so a saved change takes effect immediately without an app
 * restart. NFS_MOUNT_PATH/LOCAL_STORAGE_PATH env vars remain the bootstrap
 * defaults for a fresh install (nothing in SystemSetting yet).
 *
 * "NFS" here means a directory the server admin has already mounted a real
 * NFS share onto at the OS level (e.g. via /etc/fstab) - the app never runs
 * `mount` itself, it only reads/writes files under that directory and
 * probes it's actually there. In this dev sandbox it's a plain local
 * directory (`storage/nfs-mock`), which is fine: the adapter code and
 * fallback logic are identical either way, and unavailability was tested
 * with `chmod 000` on that directory (see docs/BUILD_PROGRESS.md). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly defaultNfsRoot: string;
  private readonly localRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {
    this.defaultNfsRoot = path.resolve(this.config.get<string>("NFS_MOUNT_PATH") ?? "./storage/nfs-mock");
    this.localRoot = path.resolve(this.config.get<string>("LOCAL_STORAGE_PATH") ?? "./storage/local");
  }

  async getConfig(): Promise<StorageConfig> {
    const values = await this.settings.getMany(Object.values(KEYS));
    return {
      nfsEnabled: values[KEYS.nfsEnabled] == null ? true : values[KEYS.nfsEnabled] === "true",
      nfsHost: values[KEYS.nfsHost] ?? "",
      nfsExportPath: values[KEYS.nfsExportPath] ?? "",
      nfsMountPath: values[KEYS.nfsMountPath] ?? this.defaultNfsRoot,
    };
  }

  async updateConfig(dto: { nfsEnabled: boolean; nfsHost?: string; nfsExportPath?: string; nfsMountPath: string }): Promise<StorageConfig> {
    await this.settings.setMany([
      { key: KEYS.nfsEnabled, value: String(dto.nfsEnabled) },
      { key: KEYS.nfsHost, value: dto.nfsHost ?? "" },
      { key: KEYS.nfsExportPath, value: dto.nfsExportPath ?? "" },
      { key: KEYS.nfsMountPath, value: dto.nfsMountPath },
    ]);
    return this.getConfig();
  }

  async isNfsHealthy(): Promise<boolean> {
    const { nfsEnabled, nfsMountPath } = await this.getConfig();
    if (!nfsEnabled) return false;
    const healthy = await isNfsHealthy(path.resolve(nfsMountPath));
    if (!healthy) this.logger.warn("NFS health probe failed");
    return healthy;
  }

  /** Tries NFS first; falls back to local storage on any failure. Never
   * throws for a storage-unavailable condition - only for genuinely
   * unexpected errors (disk full, permission denied on *both* targets). */
  async write(buffer: Buffer, relativePath: string): Promise<StorageWriteResult> {
    const checksum = checksumOf(buffer);
    const sizeBytes = buffer.length;
    const { nfsEnabled, nfsMountPath } = await this.getConfig();
    const nfsRoot = path.resolve(nfsMountPath);

    if (nfsEnabled && (await this.isNfsHealthy())) {
      try {
        const fullPath = path.join(nfsRoot, relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, buffer);
        return { storagePath: relativePath, storageStatus: "NFS_STORED", checksum, sizeBytes };
      } catch (err) {
        this.logger.warn(`NFS write failed, falling back to local: ${(err as Error).message}`);
      }
    }

    const fullPath = path.join(this.localRoot, "pending", relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return { storagePath: relativePath, storageStatus: "LOCAL_PENDING_SYNC", checksum, sizeBytes };
  }

  async read(relativePath: string, storageStatus: string): Promise<Buffer> {
    if (storageStatus === "NFS_STORED" || storageStatus === "SYNCED") {
      const { nfsMountPath } = await this.getConfig();
      return fs.readFile(path.join(path.resolve(nfsMountPath), relativePath));
    }
    return readLocalPending(this.localRoot, relativePath);
  }
}
