import { Injectable } from "@nestjs/common";
import { EncryptionService } from "../common/encryption.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!row || row.value == null) return null;
    return row.isSecret ? this.encryption.decrypt(row.value) : row.value;
  }

  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const out: Record<string, string | null> = {};
    for (const key of keys) {
      const row = byKey.get(key);
      out[key] = !row || row.value == null ? null : row.isSecret ? this.encryption.decrypt(row.value) : row.value;
    }
    return out;
  }

  async set(key: string, value: string, isSecret = false): Promise<void> {
    const stored = isSecret ? this.encryption.encrypt(value) : value;
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: stored, isSecret },
      create: { key, value: stored, isSecret },
    });
  }

  /** Sets many settings at once; entries with an undefined value (e.g. a
   * password field left blank in an edit form) are skipped rather than
   * overwritten, so admins can update non-secret fields without re-entering
   * a password every time. */
  async setMany(entries: Array<{ key: string; value: string | undefined; isSecret?: boolean }>): Promise<void> {
    for (const entry of entries) {
      if (entry.value === undefined) continue;
      await this.set(entry.key, entry.value, entry.isSecret ?? false);
    }
  }
}
