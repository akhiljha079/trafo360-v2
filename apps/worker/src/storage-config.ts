import { PrismaClient } from "@prisma/client";
import * as path from "node:path";

/** The NFS mount path is admin-editable (Administration -> Storage, see
 * StorageService.getConfig() on the API side) - looked up fresh here too,
 * not just once at worker startup, so a saved change takes effect on this
 * process's very next tick without a restart. Falls back to the
 * NFS_MOUNT_PATH env var (or the dev-sandbox default) only when nothing's
 * been saved to SystemSetting yet - same bootstrap-default behavior the API
 * uses. No NestJS/SettingsService here (this is a plain script, not a Nest
 * app), so this reads the row directly - the value isn't a secret, no
 * decryption needed. */
export async function getNfsRoot(prisma: PrismaClient): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "storage.nfsMountPath" } });
  const configured = row?.value;
  return path.resolve(configured || process.env.NFS_MOUNT_PATH || "./storage/nfs-mock");
}
