import { IsOptional, IsString } from "class-validator";

export class UpsertPhysicalFileLocationDto {
  @IsOptional()
  @IsString()
  building?: string;

  @IsOptional()
  @IsString()
  floor?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsString()
  rack?: string;

  @IsOptional()
  @IsString()
  shelf?: string;

  @IsOptional()
  @IsString()
  box?: string;

  @IsOptional()
  @IsString()
  archiveLocation?: string;
}
