import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
}

/** Insert-only audit trail (spec §47). No update/delete method exists here
 * or anywhere in the API on purpose - once written, an entry is permanent. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId ?? null,
        oldValue: entry.oldValue == null ? undefined : (entry.oldValue as object),
        newValue: entry.newValue == null ? undefined : (entry.newValue as object),
        reason: entry.reason ?? null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
