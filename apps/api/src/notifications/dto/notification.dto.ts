import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class UpsertNotificationTemplateDto {
  @IsString()
  eventKey!: string;

  @IsIn(["EMAIL", "WHATSAPP", "INAPP"])
  channel!: "EMAIL" | "WHATSAPP" | "INAPP";

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpsertNotificationRuleDto {
  @IsString()
  eventKey!: string;

  @IsBoolean()
  emailEnabled!: boolean;

  @IsBoolean()
  whatsappEnabled!: boolean;

  @IsBoolean()
  inAppEnabled!: boolean;
}
