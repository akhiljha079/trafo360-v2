import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateAdConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsIn(["ldap", "ldaps"])
  protocol!: "ldap" | "ldaps";

  @IsString()
  baseDn!: string;

  @IsOptional()
  @IsString()
  userSearchDn?: string;

  @IsString()
  bindUser!: string;

  /** Left undefined on edit = keep the existing stored password. */
  @IsOptional()
  @IsString()
  bindPassword?: string;

  @IsString()
  userSearchFilter!: string;

  @IsOptional()
  @IsString()
  groupSearchBase?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsInt()
  @Min(500)
  @Max(60000)
  connectTimeoutMs!: number;
}
