import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Framework-agnostic storage primitives (spec §36/§37), shared between the
// API (upload path) and the worker (sync job) so the two never drift on
// what "NFS_STORED" vs "LOCAL_PENDING_SYNC" actually means on disk.

/** Turns a human name into a filesystem-safe folder segment: lowercase,
 * spaces/punctuation collapsed to single hyphens, trimmed, capped so deep
 * paths don't hit OS path-length limits. Used to build the NFS folder
 * structure out of real project numbers/document type/title names instead
 * of opaque database IDs - so anyone browsing the Synology share directly
 * can actually tell what a folder is without cross-referencing the DB. */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "untitled").slice(0, maxLength);
}

export function checksumOf(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([fn(), new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/** Canary write+delete with a short timeout, so a hung mount can't block
 * the caller indefinitely. */
export async function isNfsHealthy(nfsRoot: string, timeoutMs = 2000): Promise<boolean> {
  const probePath = path.join(nfsRoot, ".health-probe", `${crypto.randomUUID()}.tmp`);
  try {
    await withTimeout(async () => {
      await fs.mkdir(path.dirname(probePath), { recursive: true });
      await fs.writeFile(probePath, "ok");
      await fs.unlink(probePath);
    }, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export async function readLocalPending(localRoot: string, relativePath: string): Promise<Buffer> {
  return fs.readFile(path.join(localRoot, "pending", relativePath));
}

/** Copies a locally-pending file to NFS, verifying the checksum both before
 * the copy (has the local file been tampered with/corrupted since upload?)
 * and after (did the write actually succeed correctly?). Never deletes the
 * local copy - that's the caller's job, only after this returns true. */
export async function copyLocalToNfs(
  localRoot: string,
  nfsRoot: string,
  relativePath: string,
  expectedChecksum: string,
): Promise<void> {
  const localPath = path.join(localRoot, "pending", relativePath);
  const nfsPath = path.join(nfsRoot, relativePath);
  const buffer = await fs.readFile(localPath);
  if (checksumOf(buffer) !== expectedChecksum) {
    throw new Error("Local file checksum no longer matches the recorded checksum - refusing to sync");
  }
  await fs.mkdir(path.dirname(nfsPath), { recursive: true });
  await fs.writeFile(nfsPath, buffer);
  const verifyBuffer = await fs.readFile(nfsPath);
  if (checksumOf(verifyBuffer) !== expectedChecksum) {
    throw new Error("Post-write NFS checksum verification failed");
  }
}

export async function removeLocalPending(localRoot: string, relativePath: string): Promise<void> {
  await fs.unlink(path.join(localRoot, "pending", relativePath)).catch(() => undefined);
}
