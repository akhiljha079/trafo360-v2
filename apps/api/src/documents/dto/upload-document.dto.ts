import { IsOptional, IsString } from "class-validator";

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  documentId?: string; // set when uploading a new version of an existing document

  @IsOptional()
  @IsString()
  documentTypeId?: string; // required when documentId is not set

  @IsOptional()
  @IsString()
  projectDocumentRequirementId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  confidentialityLevelId?: string;

  @IsOptional()
  @IsString()
  revisionReason?: string;
}
