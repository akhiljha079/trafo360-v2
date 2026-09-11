import { Controller, Get, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { CurrentUserId } from "../common/current-user.decorator";
import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Auth()
  search(@Query("q") q: string | undefined, @CurrentUserId() userId: string) {
    return this.searchService.search(userId, q ?? "");
  }
}
