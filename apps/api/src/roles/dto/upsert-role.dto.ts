import { IsOptional, IsString } from "class-validator";

export class UpsertRoleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  maxConfidentialityLevelId?: string;
}
