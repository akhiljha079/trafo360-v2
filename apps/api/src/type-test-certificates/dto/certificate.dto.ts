import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateCertificateDto {
  @IsString()
  transformerType!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  certificateNo?: string;

  @IsDateString()
  expiryDate!: string;
}

export class RenewCertificateDto {
  @IsDateString()
  expiryDate!: string;

  @IsOptional()
  @IsString()
  certificateNo?: string;
}
