import { PrismaClient } from "@prisma/client";
import { copyLocalToNfs, isNfsHealthy, removeLocalPending } from "@trafo360/shared";
import * as path from "node:path";

const MAX_ATTEMPTS = 5;

/** Storage sync job (spec §37): finds DocumentVersions stuck in
 * LOCAL_PENDING_SYNC, copies them to NFS once it's reachable, verifies the
 * checksum, and only then deletes the local temp copy.
 *
 * Runs on a plain `setInterval` rather than a BullMQ queue - this
 * environment has no Redis available (see docs/BUILD_PROGRESS.md), and the
 * actual sync *logic* here doesn't change when migrating to a real queue
 * later; only the scheduling/retry mechanism would. A queue buys retry
 * backoff, distributed workers, and job introspection - genuinely worth
 * having in production, but not a functional requirement for this logic to
 * be correct today. */
export async function runSyncCycle(prisma: PrismaClient): Promise<void> {
  const nfsRoot = path.resolve(process.env.NFS_MOUNT_PATH ?? "./storage/nfs-mock");
  const localRoot = path.resolve(process.env.LOCAL_STORAGE_PATH ?? "./storage/local");

  const pending = await prisma.documentVersion.findMany({
    where: { storageStatus: "LOCAL_PENDING_SYNC" },
    take: 25,
  });
  if (pending.length === 0) return;

  const nfsOnline = await isNfsHealthy(nfsRoot);
  if (!nfsOnline) {
    // eslint-disable-next-line no-console
    console.log(`[worker] NFS unavailable, ${pending.length} document(s) still pending`);
    return;
  }

  for (const version of pending) {
    const existingJob = await prisma.storageSyncJob.findFirst({
      where: { documentVersionId: version.id },
      orderBy: { createdAt: "desc" },
    });
    const attempt = (existingJob?.attempt ?? 0) + 1;

    try {
      await copyLocalToNfs(localRoot, nfsRoot, version.storagePath, version.checksum);
      await prisma.documentVersion.update({ where: { id: version.id }, data: { storageStatus: "NFS_STORED" } });
      await removeLocalPending(localRoot, version.storagePath);
      await prisma.storageSyncJob.create({
        data: { documentVersionId: version.id, attempt, status: "SUCCEEDED" },
      });
      // eslint-disable-next-line no-console
      console.log(`[worker] synced ${version.id} to NFS (attempt ${attempt})`);
    } catch (err) {
      const message = (err as Error).message;
      const failed = attempt >= MAX_ATTEMPTS;
      await prisma.storageSyncJob.create({
        data: { documentVersionId: version.id, attempt, status: "FAILED", error: message },
      });
      if (failed) {
        await prisma.documentVersion.update({ where: { id: version.id }, data: { storageStatus: "SYNC_FAILED" } });
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[worker] sync failed for ${version.id} (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}${failed ? " - giving up, marked SYNC_FAILED" : ""}`,
      );
    }
  }
}
