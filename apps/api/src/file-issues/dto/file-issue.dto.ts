import { IsDateString, IsOptional, IsString } from "class-validator";

export class RequestFileIssueDto {
  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsDateString()
  dueDate!: string;
}

export class ReturnFileDto {
  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class RequestExtensionDto {
  @IsDateString()
  requestedDueDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
