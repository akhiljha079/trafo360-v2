import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateSmtpConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsOptional()
  @IsString()
  user?: string;

  /** Left undefined on edit = keep the existing stored password. */
  @IsOptional()
  @IsString()
  password?: string;

  @IsEmail()
  fromEmail!: string;

  @IsString()
  fromName!: string;
}

export class SendTestEmailDto {
  @IsEmail()
  toEmail!: string;
}
