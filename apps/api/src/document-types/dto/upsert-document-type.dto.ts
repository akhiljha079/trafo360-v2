import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpsertDocumentTypeDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  confidentialityLevelId?: string;

  @IsOptional()
  @IsBoolean()
  multipleFilesAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  versionControlled?: boolean;

  @IsOptional()
  @IsBoolean()
  expiryRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  retentionYears?: number;

  @IsOptional()
  @IsString()
  fileNamingRule?: string;
}
