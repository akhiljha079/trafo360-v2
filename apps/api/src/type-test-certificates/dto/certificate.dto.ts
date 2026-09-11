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

/** Metadata-only correction - no file, no expiry-date reminder-clock
 * reset. Use "renew" for a new file/expiry (see TypeTestCertificatesService
 * doc comment on renew()). */
export class UpdateCertificateDto {
  @IsOptional()
  @IsString()
  transformerType?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  certificateNo?: string;
}
