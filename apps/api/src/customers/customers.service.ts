import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertCustomerDto } from "./dto/upsert-customer.dto";

export interface ListCustomersQuery {
  search?: string;
  active?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCustomersQuery) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = {
      ...(query.active !== undefined ? { active: query.active === "true" } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { code: { contains: query.search, mode: "insensitive" as const } },
              { contactPerson: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { projects: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  async create(dto: UpsertCustomerDto, actorUserId: string, ip?: string) {
    const existing = await this.prisma.customer.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException("A customer with that code already exists");
    const customer = await this.prisma.customer.create({ data: dto });
    await this.audit.log({
      userId: actorUserId,
      action: "CUSTOMER_CREATED",
      objectType: "Customer",
      objectId: customer.id,
      newValue: dto,
      ipAddress: ip,
    });
    return customer;
  }

  async update(id: string, dto: UpsertCustomerDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.customer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Customer not found");
    const customer = await this.prisma.customer.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: actorUserId,
      action: "CUSTOMER_UPDATED",
      objectType: "Customer",
      objectId: id,
      oldValue: before,
      newValue: dto,
      ipAddress: ip,
    });
    return customer;
  }

  /** Project.customerId has no ON DELETE CASCADE (deliberately, per
   * schema.prisma) - Postgres itself refuses to delete a customer that
   * still has projects, same safety net used for project deletion, rather
   * than this service adding its own cascade/guard logic. */
  async delete(id: string, actorUserId: string, ip?: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException("Customer not found");

    try {
      await this.prisma.customer.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
        throw new ConflictException("This customer still has projects tied to it - remove or reassign those first.");
      }
      throw err;
    }

    await this.audit.log({
      userId: actorUserId,
      action: "CUSTOMER_DELETED",
      objectType: "Customer",
      objectId: id,
      oldValue: { code: customer.code, name: customer.name },
      ipAddress: ip,
    });
  }
}
