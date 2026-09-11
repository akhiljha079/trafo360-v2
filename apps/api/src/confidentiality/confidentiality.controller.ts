import { Controller, Get } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("confidentiality-levels")
@Auth()
export class ConfidentialityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.confidentialityLevel.findMany({ orderBy: { rank: "asc" } });
  }
}
