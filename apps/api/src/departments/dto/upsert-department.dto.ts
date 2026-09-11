import { IsBoolean, IsOptional, IsString } from "class-validator";

export class UpsertDepartmentDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  headId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
