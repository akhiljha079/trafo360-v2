import { Controller, Get } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { CurrentUserId } from "../common/current-user.decorator";
import { DashboardsService } from "./dashboards.service";

@Controller("dashboards")
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get("summary")
  @Auth()
  summary(@CurrentUserId() userId: string) {
    return this.dashboards.getSummary(userId);
  }
}
