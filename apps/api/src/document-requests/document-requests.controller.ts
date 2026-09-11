import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { ClientIp, CurrentUserId } from "../common/current-user.decorator";
import { DocumentRequestsService } from "./document-requests.service";
import { CreateDocumentRequestDto } from "./dto/create-document-request.dto";

@Controller("document-requests")
export class DocumentRequestsController {
  constructor(private readonly documentRequests: DocumentRequestsService) {}

  @Get()
  @Auth("document.share")
  list(@Query("status") status: string | undefined, @Query("documentId") documentId: string | undefined) {
    return this.documentRequests.list({ status, documentId });
  }

  @Post()
  @Auth("document.share")
  create(@Body() dto: CreateDocumentRequestDto, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.documentRequests.create(dto, userId, ip);
  }

  @Post(":id/approve")
  @Auth("confidential.view")
  approve(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.documentRequests.approve(id, userId, ip);
  }

  @Post(":id/reject")
  @Auth("confidential.view")
  reject(@Param("id") id: string, @CurrentUserId() userId: string, @ClientIp() ip?: string) {
    return this.documentRequests.reject(id, userId, ip);
  }
}
