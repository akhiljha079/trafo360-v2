import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { checksumOf, isNfsHealthy, readLocalPending } from "@trafo360/shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface StorageWriteResult {
  storagePath: string; // relative path, stored in the DB - never a raw absolute path handed to a client
  storageStatus: "NFS_STORED" | "LOCAL_PENDING_SYNC";
  checksum: string;
  sizeBytes: number;
}

/** NFS + local-fallback storage (architecture plan §6, spec §36/§37). The
 * actual read/write/checksum/health-probe primitives live in
 * libs/shared/src/storage-primitives.ts so the worker's sync job (which is
 * a plain Node process, not a Nest app) can reuse them without duplicating
 * this logic - this class is a thin Nest-config-aware wrapper around them.
 *
 * "NFS" here is `NFS_MOUNT_PATH`, a directory the ops team is expected to
 * mount a real NFS share onto - the app never manages the mount itself. In
 * this dev sandbox it's a plain local directory (`storage/nfs-mock`), which
 * is fine: the adapter code and fallback logic are identical either way,
 * and unavailability was tested with `chmod 000` on that directory (see
 * docs/BUILD_PROGRESS.md). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly nfsRoot: string;
  private readonly localRoot: string;

  constructor(private readonly config: ConfigService) {
    this.nfsRoot = path.resolve(this.config.get<string>("NFS_MOUNT_PATH") ?? "./storage/nfs-mock");
    this.localRoot = path.resolve(this.config.get<string>("LOCAL_STORAGE_PATH") ?? "./storage/local");
  }

  async isNfsHealthy(): Promise<boolean> {
    const healthy = await isNfsHealthy(this.nfsRoot);
    if (!healthy) this.logger.warn("NFS health probe failed");
    return healthy;
  }

  /** Tries NFS first; falls back to local storage on any failure. Never
   * throws for a storage-unavailable condition - only for genuinely
   * unexpected errors (disk full, permission denied on *both* targets). */
  async write(buffer: Buffer, relativePath: string): Promise<StorageWriteResult> {
    const checksum = checksumOf(buffer);
    const sizeBytes = buffer.length;

    if (await this.isNfsHealthy()) {
      try {
        const fullPath = path.join(this.nfsRoot, relativePath);
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
      return fs.readFile(path.join(this.nfsRoot, relativePath));
    }
    return readLocalPending(this.localRoot, relativePath);
  }
}
