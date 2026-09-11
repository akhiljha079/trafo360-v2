import { Controller, Get, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { PrismaService } from "../prisma/prisma.service";

interface AuditQuery {
  objectType?: string;
  userId?: string;
  action?: string;
  page?: string;
  pageSize?: string;
}

/** Read-only. No PATCH/DELETE exists anywhere for audit logs, on purpose
 * (spec §47 - tamper-resistant trail). */
@Controller("audit-logs")
@Auth("audit.view")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: AuditQuery) {
    const page = query.page ? Number(query.page) : 1;
    const pageSize = Math.min(query.pageSize ? Number(query.pageSize) : 50, 200);
    const where = {
      ...(query.objectType ? { objectType: query.objectType } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
