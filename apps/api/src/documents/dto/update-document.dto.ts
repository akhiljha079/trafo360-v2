import { IsOptional, IsString } from "class-validator";

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  documentTypeId?: string;

  @IsOptional()
  @IsString()
  confidentialityLevelId?: string;
}
