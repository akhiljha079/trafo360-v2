import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateDocumentRequestDto {
  @IsString()
  documentId!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsDateString()
  requiredUntil?: string;
}
