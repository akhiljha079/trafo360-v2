import { Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { CurrentUserId } from "../common/current-user.decorator";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@Auth()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query("unread") unread: string | undefined, @CurrentUserId() userId: string) {
    return this.notifications.listForUser(userId, unread === "true");
  }

  @Get("unread-count")
  unreadCount(@CurrentUserId() userId: string) {
    return this.notifications.unreadCount(userId).then((count) => ({ count }));
  }

  @Patch(":id/read")
  markRead(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.notifications.markRead(id, userId);
  }

  @Post("mark-all-read")
  markAllRead(@CurrentUserId() userId: string) {
    return this.notifications.markAllRead(userId);
  }
}
