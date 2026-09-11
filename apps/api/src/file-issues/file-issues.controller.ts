import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { RequestExtensionDto, RequestFileIssueDto, ReturnFileDto } from "./dto/file-issue.dto";
import { FileIssuesService } from "./file-issues.service";

@Controller("physical-files/:physicalFileId/issue-requests")
export class PhysicalFileIssueRequestsController {
  constructor(private readonly fileIssues: FileIssuesService) {}

  @Post()
  @Auth("physical_file.create")
  request(
    @Param("physicalFileId") physicalFileId: string,
    @Body() dto: RequestFileIssueDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.fileIssues.requestIssue(physicalFileId, dto, userId, ip);
  }
}

@Controller("file-issues")
export class FileIssuesController {
  constructor(private readonly fileIssues: FileIssuesService) {}

  @Get()
  @Auth("physical_file.view")
  list(
    @Query("status") status: string | undefined,
    @Query("overdue") overdue: string | undefined,
    @Query("physicalFileId") physicalFileId: string | undefined,
  ) {
    return this.fileIssues.list({ status, overdue: overdue === "true", physicalFileId });
  }

  @Get(":id")
  @Auth("physical_file.view")
  get(@Param("id") id: string) {
    return this.fileIssues.get(id);
  }

  /** Manual trigger, same idea as workflow instantiation and AD sync -
   * the worker also runs this on a schedule (spec §31), this is for "check
   * right now" without waiting for the next tick. */
  @Post("check-overdue")
  @Auth("physical_file.approve")
  checkOverdue() {
    return this.fileIssues.markOverdueTransactions().then((count) => ({ markedOverdue: count }));
  }

  @Post("check-due-tomorrow")
  @Auth("physical_file.approve")
  checkDueTomorrow() {
    return this.fileIssues.notifyDueTomorrow().then((count) => ({ notified: count }));
  }

  @Post(":id/approve")
  @Auth("physical_file.approve")
  approve(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.fileIssues.approve(id, userId, ip);
  }

  @Post(":id/issue")
  @Auth("physical_file.issue")
  issue(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.fileIssues.issue(id, userId, ip);
  }

  @Post(":id/return")
  @Auth("physical_file.return")
  returnFile(@Param("id") id: string, @Body() dto: ReturnFileDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.fileIssues.returnFile(id, dto, userId, ip);
  }

  @Post(":id/extension-requests")
  @Auth("physical_file.create")
  requestExtension(
    @Param("id") id: string,
    @Body() dto: RequestExtensionDto,
    @CurrentUserId() userId: string,
    @ClientIp() ip?: string,
  ) {
    return this.fileIssues.requestExtension(id, dto, userId, ip);
  }
}

@Controller("extension-requests")
export class ExtensionRequestsController {
  constructor(private readonly fileIssues: FileIssuesService) {}

  @Post(":id/approve")
  @Auth("physical_file.approve")
  approve(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.fileIssues.approveExtension(id, userId, ip);
  }

  @Post(":id/reject")
  @Auth("physical_file.approve")
  reject(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.fileIssues.rejectExtension(id, userId, ip);
  }
}
