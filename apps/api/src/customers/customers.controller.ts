import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { CustomersService, ListCustomersQuery } from "./customers.service";
import { UpsertCustomerDto } from "./dto/upsert-customer.dto";

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Auth()
  list(@Query() query: ListCustomersQuery) {
    return this.customers.list({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get(":id")
  @Auth()
  get(@Param("id") id: string) {
    return this.customers.get(id);
  }

  @Post()
  @Auth("customer.manage")
  create(@Body() dto: UpsertCustomerDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.customers.create(dto, userId, ip);
  }

  @Patch(":id")
  @Auth("customer.manage")
  update(@Param("id") id: string, @Body() dto: UpsertCustomerDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.customers.update(id, dto, userId, ip);
  }

  @Delete(":id")
  @HttpCode(200)
  @Auth("customer.manage")
  async remove(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    await this.customers.delete(id, userId, ip);
    return { ok: true };
  }
}
